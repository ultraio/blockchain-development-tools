# Why is UOS conversion rate oracle important?

Some of the critical Ultra Blockchain functionality relies on having accurate conversion rate information for UOS-USD pair. BP payouts and NFT trading for example rely on fixed USD amounts but are performed using UOS thus the conversion is required.

For local development purpose you may at some point encounter issues related to missing oracle conversion rates like `no available MA rate found` which refer to missing trading information from the exchanges. On the Public Testnet / Public Mainnet this information is provided and pushed by Ultra, but locally it will be missing for you and so the goal of this tool is exactly to provide this missing information in a configurable way.

# How to use fake oracle

This fake oracle is written in Node.js and thus requires a Node installation on the machine running the tool. If you are using prebuilt Docker image then the dependencies should already be installed for you.

For native Ubuntu installation we strongly recommend using [NVM](https://github.com/nvm-sh/nvm) to manage different Node installations. For this tool we recommend version 14.18

```sh
nvm install 14.18.0
```

To get all the packages required to run the oracle tool use the following command

```sh
npm ci
```

To run the basic constant conversion rate on-chain just run the `fake_oracle.js` script

```sh
node fake_oracle.js
```

This tool assumes you already have `nodeos` running locally. You have an option to specify remote `nodeos` HTTP endpoint as well but you will still need to have a `keosd` instance running which is done automatically when using `ultratest` utility or when using a bootup script, in other cases you will have to manually start the `keosd` instance under the HTTP address `127.0.0.1:8899` and create a wallet.

## Basic options

1. `-c, --config` - Provide configuration for oracle rates pushed over time

This option expects a relative or absolute path to the JSON file containing the rates specification to be pushed on chain. Default value is `config.json`. In case no config is provided and default `config.json` does not exist then all rates pushed will be constant 1 UOS-USD.

2. `-i, --interval` - Specify pushrate interval in ms for all exchanges

This option allows you to change how often rates are pushed on-chain. The default value of 1 second (1000 ms) mimics the behavior of Public Testnet / Public Mainnet but you can specify a higher value if you want to test the behavior under some heavy system downtime. Note that values < 1 second are not advised since they will be resulting in frequent error logs and will not provide any meaningful benefits.

3. `-n, --nodeos-endpoint` - nodeos endpoint to push oracle rates to

You can specify a different nodeos endpoint in case you are working with a remote nodeos instance or want to push locally under a different port. Default endpoint is `http://127.0.0.1:8888`

4. `-p, --private-key` - Specify private key used to push oracle rates

Allows you to import multiple private keys into the default wallet. This option can be repeated multiple times. If you are using `ultratest` tool on the same machine which is running the fake oracle then you most likely have all the necessary keys to run the fake oracle. Note that the keys should be in WIF format like `5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3`

5. `-v, --verbose` - Print extra information

If you are having some issues or incorrect rates pushed on-chain you can use this option to gain more information about what the fake oracle is using and pushing to potentially resolve problems in your configuration file, wallet setup or network configuration

6. `-V, --version` - Output the version number
7. `-h, --help` - Output usage information

Note that all CLI arguments of this tool are optional

## Config specification

For the basic example on the `config.json` you can refer to [config_example.json](config_example.json)

Information from the configuration file is assumed to be an array of objects each of which should be specifying the `source` which provides the conversion rate, conversion `rate` itself, 24 hour trading `volume` and a `timestamp`. `rate` is specified in USD/UOS unit, 24 trading volume is specified in USD, timestamp is specified in seconds. Example: rate of 1.2345 USD/UOS pushed by `exchange` with 24 trading volume of 500000 USD 

```json
[
	{"source": "exchange", "rate":1.2345, "volume":500000.0, "timestamp": 1644334178}
]
```

`source` is required to be a string, `rate` and `volume` are expected to be a floating point numbers. `timestamp` is represented by a number. It should also be noted that in case the specified `source` is not a registered exchange on-chain, then the tool will try to register this exchange automatically.

You don't need to provide the conversion rate information for each second and instead can provide list of rates with gaps. Fake oracle will push the last rate for each of the exchanges until there is a new rule specified after reaching a new timestamp. In the following example `exchange1` will keep pushing the rate of `1.0` while `exchange2` will be initially pushing the rate of `2.0` and after 10 seconds will switch to pushing the rate of `3.0` indefinitely.

```json
[
	{"source": "exchange1", "rate":1.0, "volume":500000.0, "timestamp": 10},
	{"source": "exchange2", "rate":2.0, "volume":500000.0, "timestamp": 10},
	{"source": "exchange2", "rate":3.0, "volume":500000.0, "timestamp": 20}
]
```

By specifying a `"*"` as a `source` of the conversion rate you can change the rate pushed by all exchanges. In the following example after reaching the timestamp of 20 both exchanges (`exchange1` and `exchange2` will switch to the rate of `3.0`).

```json
[
	{"source": "exchange1", "rate":1.0, "volume":500000.0, "timestamp": 10},
	{"source": "exchange2", "rate":2.0, "volume":500000.0, "timestamp": 10},
	{"source": "*", "rate":3.0, "volume":500000.0, "timestamp": 20}
]
```

Since the oracle contract has a strict limitation on the `timestamp` used for the conversion rates all timestamps specified in the config will be relative to the first timestamp specified and will be checked against the head block time at the time of starting the fake oracle. What this means is that in the following example the very first rate pushed by `exchange1` will have a timestamp of `1644334178`, each subsequent one will be 1 second ahead of the previous one. When head block time reaches `1644334188` (10 seconds after the start) fake oracle will switch to pushing a new rate of `2.0`.

```json
// head block timestamp: 1644334178
[
	{"source": "exchange1", "rate":1.0, "volume":500000.0, "timestamp": 10}
	{"source": "exchange1", "rate":2.0, "volume":500000.0, "timestamp": 20}
]
```

In case you want to stop a certain exchange (or all of them) from pushing rates on-chain you should specify the `rate` or `volume` to be `null` or `0`. This will make it so fake oracle skips this exchange until a new configuration setting is reached. In the following example `exchange1` will have rates skipped between timestamps 20 and 30.

```json
[
	{"source": "exchange1", "rate":1.0, "volume":500000.0, "timestamp": 10}
	{"source": "exchange1", "rate":null, "volume":null, "timestamp": 20}
	{"source": "exchange1", "rate":1.0, "volume":500000.0, "timestamp": 30}
]
```

The default behavior of fake oracle is to push rates indefinitely. In case you want a controlled duration you need to specify the `stop` setting. After reaching the `timestamp` associated with `stop` value the fake oracle will stop pushing rates and will exit. In the following example `exchange1` will be pushing rates between timestamps of 10 and 20 inclusively, after which the fake oracle will stop

```json
[
	{"source": "exchange1", "rate":1.0, "volume":500000.0, "timestamp": 10}
	{"stop":true, "timestamp": 20}
]
```