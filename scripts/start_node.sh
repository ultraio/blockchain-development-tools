#!/bin/bash
set -x
function usage() {
   printf "Usage: $0 OPTION...
    -h Help
    -r replay from blocks.log
   \\n" "$0" 1>&2
   exit 1
}

SCRIPT_DIR=`dirname "$0"`
while getopts "h:r" opt; do
  case "$opt" in
    h)
        usage
    ;;
    r)
        REPLAY=true
    ;;
    *)

    ;;
  esac
done
if [ "$REPLAY" = true ]; then
    ADDITONAL_OPTIONS="-r"
fi
$SCRIPT_DIR/launcher.sh -n eosio \
    -p EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV \
    -w 5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3 \
    -g EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV \
    ${ADDITONAL_OPTIONS}