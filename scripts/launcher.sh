#!/bin/bash
set -x
# Spin Up Nodeos Instance Easily
BASE_DIR=/opt/ultra_workdir
TEMPORARY_FILES_DIR=""
TEMPORARY_CONFIGS_DIR=""
CLEOS="cleos --no-auto-keosd"

mkdir -p /opt/ultra_workdir/data/config
cp eosio/data/config/. ultra_workdir/data/config

# Default Configs
RUN_LOCALLY=false

# Timeouts
KEOSD_TIMEOUT=3
KEOSD_RESPONSE_TIME=30000

# Parameter Usage Guide
function usage() {
   printf "Usage: $0 OPTION...
    -h Help
    -a - Spin up node as API
    -n <producer_name> - Name of the signing producer
    -p <public_key> - Public key that goes with -w
    -w <wif_key/sign_key> - A private key or wif.
    -g <public_key> - Set a public genesis key.
    -r replay from blocks.log.
    -x \"<nodeos command line options>\"
   \\n" "$0" 1>&2
   exit 1
}

# Parse Parameters
if [ $# -ne 0 ]; then
    while getopts "hkn:p:w:g:x:aL:r" opt; do
        case "${opt}" in
            h )
                usage
            ;;
            n )
                INSTANCE_NAME=${OPTARG}
                TEMPORARY_FILES_DIR="${TEMPORARY_FILES_DIR}/${INSTANCE_NAME}"
                TEMPORARY_CONFIGS_DIR="${TEMPORARY_CONFIGS_DIR}/${INSTANCE_NAME}"
            ;;
            p )
                PUBLIC_KEY=${OPTARG}
            ;;
            w )
                PRIVATE_KEY=${OPTARG}
            ;;
            a )
                API_MODE=true
            ;;
            g )
                GENESIS_KEY=${OPTARG}
            ;;
            x )
                if [[ -z ${API_MODE} ]]; then
                    echo "Using Producer Mode"
                    NODEOS_INJECTION="\
                        --blocks-dir=${BASE_DIR}/data/${TEMPORARY_FILES_DIR}/${INSTANCE_NAME}
                        --agent-name=${INSTANCE_NAME}
                        -c ${BASE_DIR}/data/${TEMPORARY_CONFIGS_DIR}/config_prod.ini
                    "
                fi

                NODEOS_INJECTION=${OPTARG}
            ;;
            L )
                RUN_LOCALLY=true
            ;;
            r )
                REPLAY=true
            ;;
            ? )
                echo "Invalid Option!" 1>&2
                usage
            ;;
            : )
                echo "Invalid Option: -${OPTARG} requires an argument." 1>&2
                usage
            ;;
            * )
                usage
            ;;
        esac
    done
fi

# ==========
# Assign Parameters
# ==========

if [[ -z "${INSTANCE_NAME}" ]]; then
    echo "Use parameter -n to assign a producer/api name"
    exit 1
fi
echo "Producer name set to: $INSTANCE_NAME"

if [[ -z ${API_MODE} ]]; then
    echo "Running as a producer."

    if [[ -z ${PUBLIC_KEY} ]]; then
        echo "Use parameter -p key to set a public key."
        exit 1
    fi
    echo "Public key set to: ${PUBLIC_KEY}"

    if [[ -z ${PRIVATE_KEY} ]]; then
        echo "Use parameter -w key to set a private key / wif key."
        exit 1
    fi
    echo "Private key was set."
fi

# Start keosd (http-max-response-time-ms necessary so that cleos command don't time out)
pkill -f keosd
keosd --http-max-response-time-ms=${KEOSD_RESPONSE_TIME} &
sleep ${KEOSD_TIMEOUT}

mkdir ${BASE_DIR}/data/tmpConfigs
mkdir ${BASE_DIR}/data/tmpFiles

if [[ ! -d "${BASE_DIR}/data/${TEMPORARY_FILES_DIR}" ]]; then
    mkdir ${BASE_DIR}/data/${TEMPORARY_FILES_DIR}
fi

if [[ ! -d "${BASE_DIR}/data/${TEMPORARY_CONFIGS_DIR}" ]]; then
    mkdir ${BASE_DIR}/data/${TEMPORARY_CONFIGS_DIR}
fi

# Check if bootup.wallet file exists. Then check if we're deleting it.
if [ -e ${HOME}/eosio-wallet/${INSTANCE_NAME}.wallet ]; then
    rm ${HOME}/eosio-wallet/${INSTANCE_NAME}.wallet
fi

# Create the wallet
${CLEOS} wallet create -n ${INSTANCE_NAME} --file="${BASE_DIR}/data/${TEMPORARY_FILES_DIR}/${INSTANCE_NAME}-wallet-password"
sleep 2
if [ "$PRIVATE_KEY" != "5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3" ]; then
    ${CLEOS} wallet import -n ${INSTANCE_NAME} --private-key=5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3
fi
${CLEOS} wallet import -n ${INSTANCE_NAME} --private-key=${PRIVATE_KEY}

# ==========
# Update Configuration Files
# ==========

cp ${BASE_DIR}/data/config/config.ini ${BASE_DIR}/data/${TEMPORARY_CONFIGS_DIR}/config.ini
cp ${BASE_DIR}/data/config/genesis.json ${BASE_DIR}/data/${TEMPORARY_CONFIGS_DIR}/genesis.json
cp ${BASE_DIR}/data/config/config_prod.ini ${BASE_DIR}/data/${TEMPORARY_CONFIGS_DIR}/config_prod.ini

# Update the initial_key setting for genesis.json
if [[ ! -z ${GENESIS_KEY} ]]; then
    # Not Set
    echo "Updating Genesis Key"
    jq '.initial_key = $newKey' --arg newKey ${GENESIS_KEY} ${BASE_DIR}/data/${TEMPORARY_CONFIGS_DIR}/genesis.json > ${BASE_DIR}/data/${TEMPORARY_CONFIGS_DIR}/tmp.$$.json && mv ${BASE_DIR}/data/${TEMPORARY_CONFIGS_DIR}/tmp.$$.json ${BASE_DIR}/data/${TEMPORARY_CONFIGS_DIR}/genesis.json
    cat ${BASE_DIR}/data/${TEMPORARY_CONFIGS_DIR}/genesis.json
    echo "Updated Genesis Key to: ${GENESIS_KEY}"
fi

if [[ -z ${API_MODE} ]]; then
    # Not in API Mode

    if [[ -z ${GENESIS_KEY} ]]; then
        # Not Set
        echo " " | tee -a ${BASE_DIR}/data/${TEMPORARY_CONFIGS_DIR}/config_prod.ini >/dev/null
        echo "producer-name=${INSTANCE_NAME} # Generated by Bootup" | tee -a ${BASE_DIR}/data/${TEMPORARY_CONFIGS_DIR}/config_prod.ini >/dev/null
        echo "signature-provider=${PUBLIC_KEY}=KEY:${PRIVATE_KEY} # Generated by Bootup" | tee -a ${BASE_DIR}/data/${TEMPORARY_CONFIGS_DIR}/config_prod.ini >/dev/null
    else
        # Set
        echo " " | tee -a ${BASE_DIR}/data/${TEMPORARY_CONFIGS_DIR}/config.ini >/dev/null
        echo "producer-name=${INSTANCE_NAME} # Generated by Bootup" | tee -a ${BASE_DIR}/data/${TEMPORARY_CONFIGS_DIR}/config.ini >/dev/null
        echo "signature-provider=${PUBLIC_KEY}=KEY:${PRIVATE_KEY} # Generated by Bootup" | tee -a ${BASE_DIR}/data/${TEMPORARY_CONFIGS_DIR}/config.ini >/dev/null
    fi
fi

if [ "$cors_enabled" = "true" ]; then
    cors='--access-control-allow-origin=* --access-control-allow-headers=* --access-control-allow-credentials'
fi

echo "\n $cors \n"


if [[ $REPLAY = true ]]; then
    RUN_OPTIONS="--replay-blockchain"
else
    # RUN_OPTIONS="--delete-all-blocks --delete-state-history"
fi

nodeos -e -p ${INSTANCE_NAME} \
        --signature-provider=${PUBLIC_KEY}=KEY:${PRIVATE_KEY} \
        --genesis-json ${BASE_DIR}/data/${TEMPORARY_CONFIGS_DIR}/genesis.json \
        --config-dir ${BASE_DIR}/data/${TEMPORARY_CONFIGS_DIR} \
        -c ${BASE_DIR}/data/${TEMPORARY_CONFIGS_DIR}/config.ini \
        --data-dir ${BASE_DIR}/data/${TEMPORARY_FILES_DIR}/ \
        --p2p-max-nodes-per-host=100 \
        --disable-replay-opts \
        ${RUN_OPTIONS} \
        ${NODEOS_INJECTION}
