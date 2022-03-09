#!/bin/bash
set -eo pipefail

CPU_CORES=$(getconf _NPROCESSORS_ONLN)
mkdir -p build
pushd build &> /dev/null
cmake -DCMAKE_BUILD_TYPE=Release ../
make -j $CPU_CORES
popd &> /dev/null