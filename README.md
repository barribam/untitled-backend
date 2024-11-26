# untitled-pictionary
### Requirements 
- NVM to install NodeJS version v20.18.0
- https://www.freecodecamp.org/news/node-version-manager-nvm-install-guide/
- `` nvm install --lts `` NodeJS version for long term support
- `` node --version `` Check NodeJS version (v20.18.0)

- https://docs.docker.com/desktop/install/windows-install/#install-docker-desktop-on-windows

### Steps to run development build

#### Redis Container

`` docker compose up --build `` to build container for Redis database

`` docker compose down `` to stop container

#### Build NodeJS app
`` npm install -g pnpm ``

`` pnpm install ``

`` pnpm start ``


