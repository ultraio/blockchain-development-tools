#!/bin/bash
# set -x

IMAGE=${1:-"ultra-dev:latest"}
NAME=ultra-dev-environment

case "$OSTYPE" in
linux*) IS_LINUX_BASED=1 ;;
darwin*) IS_LINUX_BASED=1 ;;
win*) IS_LINUX_BASED=0 ;;
msys*) IS_LINUX_BASED=0 ;;
cygwin*) IS_LINUX_BASED=0 ;;
*) IS_LINUX_BASED=-1 ;;
esac

# Unknown Operating System
if [ $IS_LINUX_BASED -eq -1 ]; then
  echo "Unsupported system, please use Windows (Git Bash), Linux, or MacOS"
  exit 1
fi

echo "Starting Ultra Blockchain Image"
if [ ! "$(docker ps -q -f name=$NAME --all)" ]; then
  echo "Docker Volume Mounted at $HOME/ultra_workdir"

  docker run -dit -p 8888:8888 -p 9876:9876 -v $HOME/ultra_workdir:/opt/ultra_workdir --name $NAME $IMAGE
else
  docker start $NAME
fi

# Starting Nodes, and Additional Services Here
docker exec -d -i $NAME ./scripts/start_node

# Enter Docker Container
if [[ $IS_LINUX_BASED -eq 1 ]]; then
  echo "Entering Docker Container through Linux"
  docker exec -it ultra-dev-environment bash
else
  echo "Entering Docker Container through Windows"
  winpty docker exec -it ultra-dev-environment bash
fi

echo "Docker Image is still running with name 'ultra-dev-environment' please use 'stop_docker.sh' to stop the container."

exit 0
