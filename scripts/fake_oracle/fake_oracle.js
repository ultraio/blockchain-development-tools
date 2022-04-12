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
        // config option is provided with either a string argument or with no arguments in which case it will be boolean
        this.config = '';
        if(flags.config) {
            if((typeof flags.config) === 'boolean') this.config = defaultConfig;
            else this.config = flags.config;
        }
        this.push_interval = flags.interval ? flags.interval : 1000;
        this.rates = {};
        this.finished = false;
        this.exchanges = [];
    }

    getExchangesFeed = async () => {
        return JSON.parse(await cleos(this.nodeos)(`get table eosio.oracle eosio.oracle feeddata`, {stdout:true}));
    }

    toAssetConversionRate = (value) => {
        if(value === 0 || value === null) return '';
        return value.toFixed(this.conversion_rate_precision) + ' ' + this.conversion_rate_symbol;
    }

    toAssetTradingVolume = (value) => {
        if(value === 0 || value === null) return '';
        return value.toFixed(this.trading_volume_precision) + ' ' + this.trading_volume_symbol;
    }

    registerExchange = async (source, rate = null, volume = null) => {
        assert(await cleos(this.nodeos)(`push action eosio.oracle regexchange '["${source}"]' -p ultra.oracle -f`), `Failed to register exchange "${source}"`);
        this.exchanges.push({source: source, rate_to_push: this.toAssetConversionRate(rate), volume_to_push: this.toAssetTradingVolume(volume)});
    }

    init = async () => {
        // allow importing private keys from CLI
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
        // allow providing custom pushrate config
        try {
            if(this.config === '') {
                // if config file option is not provided need to replace it with default rates
                this.rates = [{source: '*', rate: 1.0, volume: 1.0, timestamp: 0}];
                console.log('Using default constant oracle rate');
            } else if(fs.existsSync(this.config)) {
                this.rates = require(this.config);
            } else {
                console.error(chalk.bold.red(`Config file does not exist: "${this.config}"`));
                process.exit(1);
            }
        }
        catch (e) {
            console.error(chalk.bold.red(e));
            process.exit(1);
        }

        // get the list of exchanges registered on chain and populate the local list of exchange to push rates for
        let exchanges_feed = await this.getExchangesFeed();
        // empty string for rate or trading volume indicate that there is no need to push rate for this exchange
        this.exchanges = exchanges_feed.rows.map(row => { return {source: row.source, rate_to_push: '', volume_to_push: ''}; } );

        // get on-chain conversion rate symbol and trading volume symbol
        let oraclestate = JSON.parse(await cleos(this.nodeos)(`get table eosio.oracle eosio.oracle oraclestate`, {stdout:true}));
        let split = oraclestate.rows[0].conversion_rate_symbol.split(',');
        this.conversion_rate_precision = parseInt(split[0], 10);
        this.conversion_rate_symbol = split[1];
        split = oraclestate.rows[0].trading_volume_symbol.split(',');
        this.trading_volume_precision = parseInt(split[0], 10);
        this.trading_volume_symbol = split[1];
    }

    getTimestamp = async () => Math.floor(Date.now() / 1000);

    pushRate = async () => {
        const current_timestamp = await this.getTimestamp();
        if(this.rate_lookup_index < this.rates.length){
            while((current_timestamp - this.start_timestamp) >= (this.rates[this.rate_lookup_index].timestamp - this.timestamp_offset)) {
                if(verbose_output) console.log(`Processing config ${JSON.stringify(this.rates[this.rate_lookup_index])}`)
                // if 'stop' field is provided for the rate then treat it differently since it most likely
                // does not contain information about which rate to push
                if(typeof this.rates[this.rate_lookup_index].stop !== 'undefined') {
                    if(this.rates[this.rate_lookup_index].stop === true) {
                        this.finished = true;
                        break;
                    }
                } else {
                    // using * allows to modify all exchanges at once
                    if(this.rates[this.rate_lookup_index].source === '*') {
                        this.exchanges = this.exchanges.map(exchange => {
                            exchange.rate_to_push = this.toAssetConversionRate(this.rates[this.rate_lookup_index].rate);
                            exchange.volume_to_push = this.toAssetTradingVolume(this.rates[this.rate_lookup_index].volume);
                            return exchange;
                        });
                        if(verbose_output && this.exchanges.length > 0) console.log(`Switched pushrate schedule of all exchanges to rate ${this.exchanges[0].rate_to_push} and volume ${this.exchanges[0].volume_to_push}`);
                    } else {
                        const index = this.exchanges.findIndex((exchange => exchange.source === this.rates[this.rate_lookup_index].source));
                        if(index >= 0) {
                            this.exchanges[index].rate_to_push = this.toAssetConversionRate(this.rates[this.rate_lookup_index].rate);
                            this.exchanges[index].volume_to_push = this.toAssetTradingVolume(this.rates[this.rate_lookup_index].volume);
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
        let rates_pushed = 0;
        this.exchanges.map(exchange => {
            if(exchange.rate_to_push === '' || exchange.volume_to_push === '') {
                if(verbose_output) console.log(`Skipping rate for "${exchange.source}"`);
            } else {
                cleos(this.nodeos)(`push action eosio.oracle pushrate '["${exchange.source}", [[${current_timestamp}, "${exchange.rate_to_push}"]], "${exchange.volume_to_push}"]' -p ultra.oracle@pushrate -f`, {swallow:false});
                if(verbose_output) console.log(`Pushed rate ${exchange.rate_to_push} with volume ${exchange.volume_to_push} for "${exchange.source}"`);
                rates_pushed++;
            }
        });
        console.log(`Pushed rates for ${rates_pushed} exchanges at timestamp ${current_timestamp}`);

        if(!this.finished) return new Promise(resolve => setTimeout(() => this.pushRate(), this.push_interval));
        console.log('Done pushing rates');
    }

    run = async () => {
        this.start_timestamp = await this.getTimestamp();
        this.timestamp_offset = this.rates[0].timestamp;
        this.rate_lookup_index = 0;
        
        // start pushing rates recursively
        console.log(`Started pushing rates at timestamp ${this.start_timestamp}`);
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
instance.main(process.argv);
