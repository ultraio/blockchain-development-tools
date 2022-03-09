#!/bin/bash
set -x

echo "Removing Ultra Blockchain Container..."
docker stop ultra-dev-environment
docker rm ultra-dev-environment
