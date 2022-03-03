#!/bin/bash
# set -x

WORKDIR=${1:-"$HOME/ultra_workdir"}
IMAGE=${2:-"ultra-dev:latest"}
NAME=ultra_dev_environment


echo "Starting Ultra Dev Environment"
if [ ! "$(docker ps -q -f name=$NAME)" ]; then

  sudo rm -rf "$WORKDIR/data/eosio";

  mkdir -p "$WORKDIR";
  docker run -dit -p 8888:8888 -p 9876:9876 -v $WORKDIR:/opt/ultra_workdir --name $NAME $IMAGE
else
  docker start $NAME
fi

docker exec -d -i $NAME ./scripts/start_node
