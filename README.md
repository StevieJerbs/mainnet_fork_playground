# Performing flash loan through AAVE

1. Sign up for Infura, Etherscan, and have a MetaMask wallet
2. Install Hardhat CLI
2. Clone repo
3. ```npm i```
4. Update .env file with keys from Infura, etherscan, and private key from metamask wallet
4. ```npx hardhat compile```
5. In a new terminal window: ```npx hardhat node```
5. ```npx hardhat run scrips/deploy-flash-loan.sol --network localhost```


# Advanced Legacy Hardhat Project Commands

```shell
npx hardhat accounts
npx hardhat compile
npx hardhat clean
npx hardhat test
npx hardhat node
npx hardhat help
REPORT_GAS=true npx hardhat test
npx hardhat coverage
npx hardhat run scripts/deploy.ts
TS_NODE_FILES=true npx ts-node scripts/deploy.ts
npx eslint '**/*.{js,ts}'
npx eslint '**/*.{js,ts}' --fix
npx prettier '**/*.{json,sol,md}' --check
npx prettier '**/*.{json,sol,md}' --write
npx solhint 'contracts/**/*.sol'
npx solhint 'contracts/**/*.sol' --fix
```
