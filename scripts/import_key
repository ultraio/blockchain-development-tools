#!/bin/bash
WALLET_NAME=$1
PRIVATE_KEY=$2
cleos wallet unlock -n ${WALLET_NAME} --password `cat /opt/cleos/${WALLET_NAME}-wallet-password` 2> /dev/null
cleos wallet import -n ${WALLET_NAME} --private-key ${PRIVATE_KEY}