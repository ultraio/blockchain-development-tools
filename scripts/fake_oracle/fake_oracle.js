const chalk = require('chalk');
const path = require('path');
const fs = require('fs');
const args = require('args');
const {JsonRpc, Api} = require('eosjs');
const ecc = require('eosjs-ecc');
const { TextEncoder, TextDecoder } = require('util');
const exec = require('child_process').exec;
const execFile = require('child_process').execFile;
const spawn = require('child_process').spawn;
const fork = require('child_process').fork;
const fetch = require('isomorphic-fetch');
const assert = require('assert');


const banner = `
                                             
   ██╗   ██╗██╗  ████████╗██████╗  █████╗    
   ██║   ██║██║  ╚══██╔══╝██╔══██╗██╔══██╗   
   ██║   ██║██║     ██║   ██████╔╝███████║   
   ██║   ██║██║     ██║   ██╔══██╗██╔══██║   
   ╚██████╔╝███████╗██║   ██║  ██║██║  ██║   
    ╚═════╝ ╚══════╝╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝   
                                             
`;

const quit = msg => {
    console.error(chalk.bold.red(msg));
    process.exit(0);
};

args
    .option('private-key', 'Specify private key used to push oracle rates')
    .option('nodeos-endpoint', 'nodeos endpoint to push oracle rates to')
    .option('config', 'Provide configuration for oracle rates pushed over time')
    .option('verbose', 'Print extra information')
    .option('interval', 'Specify pushrate interval in ms for all exchanges')

const printBanner = () => console.log(chalk.bold.bgGray(chalk.bold.white(banner)));

const defaultNodeosEndpoint = 'http://127.0.0.1:8888';
const defaultConfig = './config.json';
var verbose_output = false;

const parseResult = (fn, cmd, options) => {
    return new Promise(async resolve => {
        let promise = new Promise((resolve, reject) => {
            fn(cmd, options, (error, stdout, stderr) => {
                if (error !== null) {
                    return reject({cmd, err:stderr});
                }
                return resolve(stdout);
            });
        });


        promise
            .then(msg => {
                if(verbose_output) {
                    console.log(cmd);
                    console.log(msg);
                }
                if(options.stdout || options.fetch) resolve(msg)
                else resolve(true)
            })
            .catch(({cmd, err}) => {
                console.error('');
                console.error(`${chalk.bold.red(`Execution error: `)} [${chalk.bold.blue(cmd)}]`);
                console.error(err.trim());
                console.error('');
                resolve(false)
            });
    });
}

async function execute(cmd, options = {}) {
    return parseResult(exec, cmd, options);
}

async function executeFile(cmd, ...args) {
    return parseResult(execFile, cmd, args);
}

const cleos = endpoint => async (cmd, options = {}) => {
    return execute(`cleos ${cmd.indexOf('-u') > -1 ? '' : `-u ${endpoint}`} ${cmd}`, options);
};

const getPublicKeys = async () => fetch('http://127.0.0.1:8899/v1/wallet/get_public_keys', {method:"POST"}).then(x => x.json()).catch(err => {
    console.error("Error getting available keys, is keosd running on port 8899?", err);
});

class FakeOracle {

    constructor(flags, nodeos, privateKey, config) {
        this.flags = flags;
        this.nodeos = flags.nodeosEndpoint ? flags.nodeosEndpoint : defaultNodeosEndpoint;
        this.privateKey = flags.privateKey ? flags.privateKey : null;
        // support is only provided for a list of private keys, if only one key is provided then turn it into array
        if(this.privateKey && !Array.isArray(this.privateKey)) this.privateKey = [this.privateKey];
        this.config = flags.config ? flags.config : defaultConfig;
        this.push_interval = flags.interval ? flags.interval : 1000;
        this.rates = {};
        this.finished = false;
        this.exchanges = [];
    }

    getExchangesFeed = async () => {
        return JSON.parse(await cleos(this.nodeos)(`get table eosio.oracle eosio.oracle feeddata`, {stdout:true}));
    }

    registerExchange = async (source, rate = '', volume = '') => {
        assert(await cleos(this.nodeos)(`push action eosio.oracle regexchange '["${source}"]' -p ultra.oracle -f`), `Failed to register exchange "${source}"`);
        this.exchanges.push({source: source, rate_to_push: rate, volume_to_push: volume});
    }

    init = async () => {
        if(this.privateKey) {
            let keys = await getPublicKeys();
            this.privateKey.map(async pkey => {
                try {
                    const privToPubKey = ecc.privateToPublic(pkey);
                    if(!keys.find(key => key === privToPubKey)) {
                        await cleos(this.nodeos)(`wallet import --private-key ${pkey}`);
                    } else {
                        console.log(`Private key for ${privToPubKey} already added`);
                    }
                } catch(e) {
                    console.error(chalk.bold.red(e));
                    process.exit(1);
                }
            });
        }
        try {
            if (fs.existsSync(this.config)) {
              this.rates = require(this.config);
            } else if(this.flags.config) {
                console.error(chalk.bold.red(`Config file does not exist: "${this.flags.config}"`));
                process.exit(1);
            } else {
                // if default config file does not exist need to replace it with default rates
                this.rates = [{source: '*', rate: '1.00000000 DUOS', volume: '1.00000000 USD', timestamp: 0}];
                console.log('Using default constant oracle rate');
            }
        }
        catch (e) {
            console.error(chalk.bold.red(e));
            process.exit(1);
        }

        // get the list of exchanges registered on chain and populate the local list of exchange to push rates for
        let exchanges_feed = await this.getExchangesFeed();
        this.exchanges = exchanges_feed.rows.map(row => { return {source: row.source, rate_to_push: '', volume_to_push: ''}; } );
    }

    getTimestamp = async () => Math.floor(Date.parse(JSON.parse(await cleos(this.nodeos)(`get info`, {stdout:true})).head_block_time) / 1000);

    pushRate = async () => {
        const current_timestamp = await this.getTimestamp();
        if(this.rate_lookup_index < this.rates.length){
            while((current_timestamp - this.start_timestamp) >= (this.rates[this.rate_lookup_index].timestamp - this.timestamp_offset)) {
                if(verbose_output) console.log(`Processing config ${JSON.stringify(this.rates[this.rate_lookup_index])}`)
                // if 'stop' field is provided for the rate then treat it differently since it most likely
                // does not contain information about which rate to push
                if(typeof this.rates[this.rate_lookup_index].stop !== 'undefined') {
                    if(this.rates[this.rate_lookup_index].stop === true) {
                        console.log('Done pushing rates');
                        this.finished = true;
                        break;
                    }
                } else {
                    // using * allows to modify all exchanges at once
                    if(this.rates[this.rate_lookup_index].source === '*') {
                        this.exchanges = this.exchanges.map(exchange => {
                            exchange.rate_to_push = this.rates[this.rate_lookup_index].rate;
                            exchange.volume_to_push = this.rates[this.rate_lookup_index].volume;
                            return exchange;
                        });
                        if(verbose_output) console.log(`Switched pushrate schedule of all exchanges to rate ${this.rates[this.rate_lookup_index].rate} and volume ${this.rates[this.rate_lookup_index].volume}`);
                    } else {
                        const index = this.exchanges.findIndex((exchange => exchange.source === this.rates[this.rate_lookup_index].source));
                        if(index >= 0) {
                            this.exchanges[index].rate_to_push = this.rates[this.rate_lookup_index].rate;
                            this.exchanges[index].volume_to_push = this.rates[this.rate_lookup_index].volume;
                            if(verbose_output) console.log(`Switched pushrate schedule of exchange "${this.rates[this.rate_lookup_index].source}" to rate ${this.exchanges[index].rate_to_push} and volume ${this.exchanges[index].volume_to_push}`);
                        } else {
                            console.log(`Unknown exchange "${this.rates[this.rate_lookup_index].source}", trying to register`);
                            await this.registerExchange(this.rates[this.rate_lookup_index].source, this.rates[this.rate_lookup_index].rate, this.rates[this.rate_lookup_index].volume);
                            console.log(`Exchange "${this.rates[this.rate_lookup_index].source}" registered successfully`);
                        }
                    }
                }
                this.rate_lookup_index++;
                if(this.rate_lookup_index >= this.rates.length) break;
            }
        }

        // if the first rate in the config has an empty 'source' field
        if(this.exchanges.length === 0) {
            console.log('No exchanges registered, trying to register a default one');
            await this.registerExchange('exchange');
            console.log('Default exchange registered successfully');
            this.rate_lookup_index = 0;
            return await this.pushRate();
        }

        // push or skip rates for all exchanges defined by the config
        this.exchanges.map(exchange => {
            if(exchange.rate_to_push === '' || exchange.volume_to_push === '') {
                if(verbose_output) console.log(`Skipping rate for "${exchange.source}"`);
            } else {
                cleos(this.nodeos)(`push action eosio.oracle pushrate '["${exchange.source}", [[${current_timestamp}, "${exchange.rate_to_push}"]], "${exchange.volume_to_push}"]' -p ultra.oracle@pushrate -f`, {swallow:false});
                if(verbose_output) console.log(`Pushed rate ${exchange.rate_to_push} with volume ${exchange.volume_to_push} for "${exchange.source}"`);
            }
        })

        if(!this.finished) return new Promise(resolve => setTimeout(() => this.pushRate(), this.push_interval));
    }

    run = async () => {
        console.log('Started pushing rates');
        this.start_timestamp = await this.getTimestamp();
        this.timestamp_offset = this.rates[0].timestamp;
        this.rate_lookup_index = 0;
        
        // start pushing rates recursively
        await this.pushRate();
    }
}

class CLI {
    async main(argv){
        printBanner();

        // parse options, set defaults and start pushing rates
        const flags = args.parse(argv);
        if(flags.verbose) verbose_output = true;
        const oracle = new FakeOracle(flags);
        await oracle.init();
        await oracle.run();

        // Killing process
        process.exit(0);
    }


}

const instance = new CLI();
let triggered = false;
module.exports = {
    cli:async args => {
        triggered = true;
        instance.main(args);
    }
};

setTimeout(() => {
    if(!triggered) instance.main(process.argv);
}, 100);