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

const printBanner = () => console.log(chalk.bold.bgGray(chalk.bold.white(banner)));

const defaultNodeosEndpoint = 'http://127.0.0.1:8888';
const defaultConfig = 'config.json';

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
                if(process.env.SHOW_LOGS && !options.swallow) console.log(msg);
                if(options.stdout || options.fetch) resolve(msg)
                else resolve(true)
            })
            .catch(({cmd, err}) => {
                if(!options.swallow) {
                    console.error('');
                    console.error(`${chalk.bold.red(`Execution error: `)} [${chalk.bold.blue(cmd)}]`);
                    console.error(err.trim());
                    console.error('');
                }
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
        this.nodeos = nodeos;
        this.privateKey = privateKey;
        if(this.privateKey && !Array.isArray(this.privateKey)) this.privateKey = [this.privateKey];
        this.config = config;
        this.rates = {};
        this.finished = false;
        this.exchanges = [];
    }

    getExchangesFeed = async () => {
        return JSON.parse(await cleos(this.nodeos)(`get table eosio.oracle eosio.oracle feeddata`, {swallow:false, stdout:true}));
    }

    registerExchange = async (source, rate = '', volume = '') => {
        let exchanges_before = (await this.getExchangesFeed()).rows.length;
        await cleos(this.nodeos)(`push action eosio.oracle regexchange '["${source}"]' -p ultra.oracle`, {swallow:false});
        let exchanges_after = (await this.getExchangesFeed()).rows.length;
        assert(exchanges_after === exchanges_before + 1, 'Failed to register exchange');
        this.exchanges.push({source: source, rate_to_push: rate, volume_to_push: volume});
    }

    init = async () => {
        if(this.privateKey) {
            let keys = await getPublicKeys();
            this.privateKey.map(async pkey => {
                const privToPubKey = ecc.privateToPublic(pkey);
                if(!keys.find(key => key === privToPubKey)) {
                    await cleos(this.nodeos)(`wallet import --private-key ${pkey}`, {swallow:false});
                } else {
                    console.log(`Private key for ${privToPubKey} already added`);
                }
            });
        }
        try {
            this.rates = require(this.config);
        }
        catch (e) {
            if(this.flags.config) {
                console.error(chalk.bold.red(e));
                process.exit(1);
            }
            this.rates = [{source: '', rate: '1.00000000 DUOS', volume: '1.00000000 USD', timestamp: 0}];
            console.log('Using default constant oracle rate');
        }

        let exchanges_feed = await this.getExchangesFeed();
        this.exchanges = exchanges_feed.rows.map(row => { return {source: row.source, rate_to_push: '', volume_to_push: ''}; } );
    }

    getTimestamp = async () => Math.floor(Date.parse(JSON.parse(await cleos(this.nodeos)(`get info`, {swallow:false, stdout:true})).head_block_time) / 1000);

    pushRate = async () => {
        const current_timestamp = await this.getTimestamp();
        if(this.rate_lookup_index < this.rates.length){
            while((current_timestamp - this.start_timestamp) >= (this.rates[this.rate_lookup_index].timestamp - this.timestamp_offset)) {
                if(this.rates[this.rate_lookup_index].source === '') {
                    this.exchanges = this.exchanges.map(exchange => {
                        exchange.rate_to_push = this.rates[this.rate_lookup_index].rate;
                        exchange.volume_to_push = this.rates[this.rate_lookup_index].volume;
                        return exchange;
                    });
                } else {
                    const index = this.exchanges.findIndex((exchange => exchange.source === this.rates[this.rate_lookup_index].source));
                    if(index >= 0) {
                        this.exchanges[index].rate_to_push = this.rates[this.rate_lookup_index].rate;
                        this.exchanges[index].volume_to_push = this.rates[this.rate_lookup_index].volume;
                    } else {
                        console.log(`Unknown exchange ${this.rates[this.rate_lookup_index].source}, trying to register`);
                        await this.registerExchange(this.rates[this.rate_lookup_index].source, this.rates[this.rate_lookup_index].rate, this.rates[this.rate_lookup_index].volume);
                    }
                }
                this.rate_lookup_index++;
                if(this.rate_lookup_index >= this.rates.length) break;
            }
        }

        if(this.exchanges.length === 0) {
            console.log('No exchanges registered, trying to register a default one');
            await this.registerExchange('exchange');
            this.rate_lookup_index = 0;
            return await this.pushRate();
        }

        this.exchanges.map(exchange => {
            if(exchange.rate_to_push === '' || exchange.volume_to_push === '') {
                console.log(`Skipping rate for "${exchange.source}"`);
            } else {
                cleos(this.nodeos)(`push action eosio.oracle pushrate '["${exchange.source}", [[${current_timestamp}, "${exchange.rate_to_push}"]], "${exchange.volume_to_push}"]' -p ultra.oracle@pushrate`, {swallow:false});
                console.log(`Pushed rate ${exchange.rate_to_push} with volume ${exchange.volume_to_push} for "${exchange.source}"`);
            }
        })

        if(!this.finished) return new Promise(resolve => setTimeout(() => this.pushRate(), 1000));
    }

    run = async () => {
        console.log('Started pushing rates');
        this.start_timestamp = await this.getTimestamp();
        this.timestamp_offset = this.rates[0].timestamp;
        this.rate_lookup_index = 0;
        
        await this.pushRate();
    }
}

class CLI {
    async main(argv){
        printBanner();

        const flags = args.parse(argv);
        const nodeos = flags.nodeosEndpoint ? flags.nodeosEndpoint : defaultNodeosEndpoint;
        const privateKey = flags.privateKey ? flags.privateKey : null;
        const config = flags.config ? flags.config : defaultConfig;
        const oracle = new FakeOracle(flags, nodeos, privateKey, config);
        await oracle.init();
        await oracle.run();
        process.exit(0);

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
