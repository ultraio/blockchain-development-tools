#!/bin/bash

echo "Stopping Ultra Blockchain Container..."
docker exec -d -i ultra-dev-environment bash -c "/opt/scripts/stop_node"
