import { NamedAddresses, NamedContracts } from '@custom-types/types';
import proposals from '@protocol/proposalsConfig';
import { expectApprox, getImpersonatedSigner } from '@test/helpers';
import chai, { expect } from 'chai';
import CBN from 'chai-bn';
import { solidity } from 'ethereum-waffle';
import { ethers } from 'hardhat';
import { abi as PCVDepositAbi } from '../../../artifacts/contracts/pcv/compound/ERC20CompoundPCVDeposit.sol/ERC20CompoundPCVDeposit.json';
import { TestEndtoEndCoordinator } from '../setup';
import { forceEth } from '../setup/utils';

describe('Turbo PCV deposit', function () {
  let contracts: NamedContracts;
  let contractAddresses: NamedAddresses;
  let deployAddress: string;
  let e2eCoord: TestEndtoEndCoordinator;
  let doLogging: boolean;
  let turboFusePCVDeposit: any;
  const depositAmount = ethers.utils.parseEther('1000000');

  before(async () => {
    chai.use(CBN(ethers.BigNumber));
    chai.use(solidity);
  });

  before(async function () {
    // Setup test environment and get contracts
    const version = 1;
    deployAddress = (await ethers.getSigners())[0].address;
    if (!deployAddress) throw new Error(`No deploy address!`);

    doLogging = Boolean(process.env.LOGGING);

    const config = {
      logging: doLogging,
      deployAddress: deployAddress,
      version: version
    };

    e2eCoord = new TestEndtoEndCoordinator(config, proposals);

    doLogging && console.log(`Loading environment...`);
    ({ contracts, contractAddresses } = await e2eCoord.loadEnvironment());
    doLogging && console.log(`Environment loaded.`);

    const signer = (await ethers.getSigners())[0];
    turboFusePCVDeposit = new ethers.Contract(contractAddresses.turboFusePCVDeposit, PCVDepositAbi, signer);

    const feiHolderSigner = await getImpersonatedSigner(contracts.tribalCouncilTimelock.address);

    // Transfer 1M Fei
    await forceEth(feiHolderSigner.address);
    const fei = contracts.fei;
    await fei.connect(feiHolderSigner).transfer(turboFusePCVDeposit.address, depositAmount);

    const balanceOfPCVDeposit = await fei.balanceOf(turboFusePCVDeposit.address);
    expect(balanceOfPCVDeposit).to.be.bignumber.equal(depositAmount);
  });

  it('should be able to deposit from Laas multisig', async () => {
    await turboFusePCVDeposit.deposit();
    expectApprox(await turboFusePCVDeposit.balance(), depositAmount, '100');
  });

  it('should be able to withdraw', async () => {
    await turboFusePCVDeposit.deposit();

    const withdrawAddress = '0xd1709e3B4e7f8854895770c7c97Cb8e8323C7D48';
    const governorSigner = await getImpersonatedSigner(contractAddresses.feiDAOTimelock);
    await turboFusePCVDeposit.connect(governorSigner).withdraw(withdrawAddress, depositAmount);

    const receivedBalance = await contracts.fei.balanceOf(withdrawAddress);
    expect(receivedBalance).to.equal(depositAmount);
  });
});
