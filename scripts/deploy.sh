#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Deploying to production server...${NC}"
ssh jack@192.168.1.199 "\
    cd /opt/remoteterm/ && \
    sudo -u remoteterm git checkout main && \
    sudo -u remoteterm git pull && \
    cd frontend && \
    sudo -u remoteterm bash -c 'source ~/.nvm/nvm.sh && npm install && npm run build' && \
    sudo systemctl restart remoteterm && \
    sudo journalctl -u remoteterm -f"

echo -e "${GREEN}=== Deploy complete! ===${NC}"
