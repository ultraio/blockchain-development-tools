#!/bin/bash
USERNAME=$1
OWNER_KEY=$2
cleos system newaccount ultra.eosio $USERNAME $OWNER_KEY  \
    --transfer \
    --gift-ram-kbytes 1024000 -p ultra.eosio
