# Getting started

Welcome to the Ultra Blockchain official development tools repository. Information provided here allows new and experienced developers to get the integration started with Ultra's blockchain.

To get going you will need to install git on the platform you are going to perform the development work

Binaries provided in this repository are specifically targeted towards Ubuntu-18.04 and if you have a machine running it natively then this is a preferred option to start your development work. For other platforms you will need to additionally install Docker

## Ubuntu-18.04

### Installing Git and dependencies

To make sure you have the latest version of the tools, scripts and instructions you should install Git and clone this repository. This is optional and you can instead opt-out and just download the "Source code" archive from the latest release.

```sh
sudo apt install git-all
```

### Installing Docker

Installing Docker on Ubuntu-18.04 is highly optional since you can run the binaries natively. In case you want to still utilize Docker then you should proceed with [official Docker installation instructions](https://docs.docker.com/engine/install/ubuntu/)

#### Running the ultra docker dev environment
```sh
# starting a dev environment
./scripts/start_docker.sh

# stopping the dev environment
./scripts/stop_docker.sh

# destroying your dev environment
./scripts/remove_docker.sh
```

## Other platforms

For other platforms binaries are not provided. As such you will have to utilize the Docker image for the purposes of running a node, compiling smart contracts and running tests

### Installing GIT

Depending on the platform the instructions may differ and you should check the instructions on the [official Git website](https://git-scm.com/downloads). Installing Git is optional and you can instead download the "Source code" archive from the latest release

### Installing Docker

Plese refer to the [installation guide](https://docs.docker.com/engine/install/)

# Getting development package

### Manual installation
1. Head on to [releases](https://github.com/ultraio/blockchain-development-tools/releases) and download files from the latest release
2. Install eosio

* Install dependencies of eosio
  ```sh
    sudo apt-get update \
    && sudo apt-get install -y libicu-dev \
                          libcurl4-gnutls-dev \
                          libusb-1.0-0-dev \
                          libtinfo5
  ```
* Install eosio package by running `sudo dpkg -i eosio.<version>.deb`. Make sure the it was installed successfully by running `nodeos --version`. The output should match the package version

3. Install eosio.cdt package using `sudo dpkg -i eosio-cdt-<version>.deb` and then run `eosio-cpp --version` to make sure it was installed successfully
4. Unpack `tester-javascript` and `eosio-contracts` and follow the [set up process](guides/16_writing-tests-for-smart-contract.md)

### Docker
Alternatively, you can download a [docker image](https://eu.gcr.io/acoustic-arch-243714/blockchain-development-tools) which comes with the above packages pre-installed and has also some development scripts.

# Further guides

To proceed with development tools usage please refer to the [dedicated starting guides](guides)