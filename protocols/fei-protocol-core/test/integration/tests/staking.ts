import {
  AutoRewardsDistributor,
  Core,
  FeiDAOTimelock,
  RewardsDistributorAdmin,
  StakingTokenWrapper,
  TribalChief,
  TribalChiefSyncExtension,
  TribalChiefSyncV2,
  Tribe
} from '@custom-types/contracts';
import { NamedAddresses, NamedContracts } from '@custom-types/types';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import proposals from '@protocol/proposalsConfig';
import { expectApprox, getImpersonatedSigner, time } from '@test/helpers';
import { forceEth } from '@test/integration/setup/utils';
import chai, { expect } from 'chai';
import CBN from 'chai-bn';
import { solidity } from 'ethereum-waffle';
import { BigNumber, Contract } from 'ethers';
import hre, { ethers } from 'hardhat';
import { TestEndtoEndCoordinator } from '../setup';

const toBN = ethers.BigNumber.from;

const setupIncentivesFixtures = async (
  core: Core,
  tribalChief: TribalChief,
  feiDAOTimelock: FeiDAOTimelock,
  rewardsDistributorAdmin: RewardsDistributorAdmin,
  autoRewardsDistributors: AutoRewardsDistributor[],
  pid: number,
  poolAllocPoints: number,
  addresses: NamedAddresses
) => {
  // TribalChief fixture: setup with non-zero block reward and various pools with allocation points
  const daoSigner = await getImpersonatedSigner(feiDAOTimelock.address);
  await forceEth(feiDAOTimelock.address);
  await tribalChief.connect(daoSigner).updateBlockReward('26150000000000000000');

  // Initialise various pools with rewards
  await tribalChief.connect(daoSigner).set(pid, poolAllocPoints, ethers.constants.AddressZero, false);
  await tribalChief.connect(daoSigner).set(12, 250, ethers.constants.AddressZero, false);
  await tribalChief.connect(daoSigner).set(13, 250, ethers.constants.AddressZero, false);
  await tribalChief.connect(daoSigner).set(14, 1000, ethers.constants.AddressZero, false);
  await tribalChief.connect(daoSigner).set(15, 100, ethers.constants.AddressZero, false);
  await tribalChief.connect(daoSigner).set(16, 500, ethers.constants.AddressZero, false);
  await tribalChief.connect(daoSigner).set(17, 250, ethers.constants.AddressZero, false);

  // Grant out roles
  await core.connect(daoSigner).grantRole(ethers.utils.id('TRIBAL_CHIEF_ADMIN_ROLE'), addresses.tribalChiefSyncV2);
  await rewardsDistributorAdmin.connect(daoSigner).becomeAdmin();

  for (const rewardDistributor of autoRewardsDistributors) {
    console.log('granting role: ', rewardDistributor.address);
    await rewardsDistributorAdmin
      .connect(daoSigner)
      .grantRole(ethers.utils.id('AUTO_REWARDS_DISTRIBUTOR_ROLE'), rewardDistributor.address);
  }
};

describe.skip('e2e-staking', function () {
  let contracts: NamedContracts;
  let contractAddresses: NamedAddresses;
  let deployAddress: string;
  let e2eCoord: TestEndtoEndCoordinator;
  let doLogging: boolean;

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
  });

  describe('TribalChief', async () => {
    async function testMultipleUsersPooling(
      tribalChief: Contract,
      lpToken: Contract,
      userAddresses: string | any[],
      incrementAmount: string | any[] | BigNumber,
      blocksToAdvance: number,
      lockLength: string | number | any[],
      totalStaked: string,
      pid: number
    ) {
      // if lock length isn't defined, it defaults to 0
      lockLength = lockLength === undefined ? 0 : lockLength;

      // approval loop
      for (let i = 0; i < userAddresses.length; i++) {
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [userAddresses[i]]
        });

        const userSigner = await ethers.getSigner(userAddresses[i]);

        await lpToken.connect(userSigner).approve(tribalChief.address, ethers.constants.MaxUint256);

        await hre.network.provider.request({
          method: 'hardhat_stopImpersonatingAccount',
          params: [userAddresses[i]]
        });
      }

      // deposit loop
      for (let i = 0; i < userAddresses.length; i++) {
        let lockBlockAmount = lockLength;
        if (Array.isArray(lockLength)) {
          lockBlockAmount = lockLength[i];
          if (lockLength.length !== userAddresses.length) {
            throw new Error('invalid lock length');
          }
        }

        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [userAddresses[i]]
        });

        const userSigner = await ethers.getSigner(userAddresses[i]);

        await tribalChief.connect(userSigner).deposit(pid, totalStaked, lockBlockAmount);

        await hre.network.provider.request({
          method: 'hardhat_stopImpersonatingAccount',
          params: [userAddresses[i]]
        });
      }

      const pendingBalances = [];
      for (let i = 0; i < userAddresses.length; i++) {
        const balance = toBN(await tribalChief.pendingRewards(pid, userAddresses[i]));
        pendingBalances.push(balance);
      }

      for (let i = 0; i < blocksToAdvance; i++) {
        for (let j = 0; j < pendingBalances.length; j++) {
          pendingBalances[j] = toBN(await tribalChief.pendingRewards(pid, userAddresses[j]));
        }

        await time.advanceBlock();

        for (let j = 0; j < userAddresses.length; j++) {
          let userIncrementAmount = incrementAmount;
          if (Array.isArray(incrementAmount)) {
            userIncrementAmount = incrementAmount[j];
            if (incrementAmount.length !== userAddresses.length) {
              throw new Error('invalid increment amount length');
            }
          }

          await expectApprox(
            toBN(await tribalChief.pendingRewards(pid, userAddresses[j])),
            pendingBalances[j].add(userIncrementAmount)
          );
        }
      }
    }

    async function unstakeAndHarvestAllPositions(
      userAddresses: string | any[],
      pid: number,
      tribalChief: Contract,
      stakedToken: Contract
    ) {
      for (let i = 0; i < userAddresses.length; i++) {
        const address = userAddresses[i];
        const startingStakedTokenBalance = await stakedToken.balanceOf(address);
        const { virtualAmount } = await tribalChief.userInfo(pid, address);
        const stakedTokens = await tribalChief.getTotalStakedInPool(pid, address);

        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [address]
        });

        const userSigner = await ethers.getSigner(address);

        await tribalChief.connect(userSigner).withdrawAllAndHarvest(pid, address);

        await hre.network.provider.request({
          method: 'hardhat_stopImpersonatingAccount',
          params: [address]
        });

        if (virtualAmount.toString() !== '0') {
          const afterStakedTokenBalance = await stakedToken.balanceOf(address);
          expect(afterStakedTokenBalance.eq(startingStakedTokenBalance.add(stakedTokens))).to.be.true;
        }
      }
    }
  });

  describe('FeiRari Tribe Staking Rewards', async () => {
    let tribe: Tribe;
    let tribalChief: TribalChief;
    let tribePerBlock: BigNumber;
    let autoRewardsDistributor: AutoRewardsDistributor;
    let rewardsDistributorAdmin: RewardsDistributorAdmin;
    let stakingTokenWrapper: StakingTokenWrapper;
    const poolAllocPoints = 1000;
    const pid = 3;
    let optimisticTimelock: SignerWithAddress;
    let totalAllocPoint: BigNumber;

    before(async () => {
      stakingTokenWrapper = contracts.stakingTokenWrapperRari as StakingTokenWrapper;
      tribalChief = contracts.tribalChief as TribalChief;
      rewardsDistributorAdmin = contracts.rewardsDistributorAdmin as RewardsDistributorAdmin;
      autoRewardsDistributor = contracts.autoRewardsDistributor as AutoRewardsDistributor;
      tribe = contracts.tribe as Tribe;

      const feiDAOTimelock = contracts.feiDAOTimelock as FeiDAOTimelock;
      const d3AutoRewardsDistributor = contracts.d3AutoRewardsDistributor as AutoRewardsDistributor;
      const fei3CrvAutoRewardsDistributor = contracts.fei3CrvAutoRewardsDistributor as AutoRewardsDistributor;

      await setupIncentivesFixtures(
        contracts.core as Core,
        tribalChief,
        feiDAOTimelock,
        rewardsDistributorAdmin,
        [autoRewardsDistributor, d3AutoRewardsDistributor, fei3CrvAutoRewardsDistributor],
        pid,
        poolAllocPoints,
        contractAddresses
      );

      tribePerBlock = await tribalChief.tribePerBlock();

      optimisticTimelock = await ethers.getSigner(contracts.optimisticTimelock.address);
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [optimisticTimelock.address]
      });
      await forceEth(optimisticTimelock.address);

      totalAllocPoint = await tribalChief.totalAllocPoint();
    });

    describe('Staking Token Wrapper', async () => {
      it('init staking token wrapper', async function () {
        totalAllocPoint = await tribalChief.totalAllocPoint();
        expect(stakingTokenWrapper.address).to.be.equal(await tribalChief.stakedToken(3));
        expect((await tribalChief.poolInfo(pid)).allocPoint).to.be.bignumber.equal(toBN(poolAllocPoints));
        expect(totalAllocPoint).to.be.gte(toBN(2000));
      });

      it('harvest rewards staking token wrapper', async function () {
        const { rariRewardsDistributorDelegator } = contractAddresses;
        await stakingTokenWrapper.harvest();
        const startingTribeBalance = await tribe.balanceOf(rariRewardsDistributorDelegator);

        const blocksToAdvance = 10;
        await hre.network.provider.send('hardhat_mine', [
          ethers.utils.hexStripZeros(BigNumber.from(blocksToAdvance).toHexString())
        ]);

        /// add 1 as calling the harvest is another block where rewards are received
        const pendingTribe = toBN(blocksToAdvance + 1)
          .mul(tribePerBlock)
          .mul(toBN(poolAllocPoints))
          .div(totalAllocPoint);

        await expect(await stakingTokenWrapper.harvest())
          .to.emit(tribalChief, 'Harvest')
          .withArgs(stakingTokenWrapper.address, pid, pendingTribe);

        expect((await tribe.balanceOf(rariRewardsDistributorDelegator)).sub(startingTribeBalance)).to.be.equal(
          pendingTribe
        );
      });
    });

    describe('AutoRewardsDistributor', async () => {
      it('should be able to properly set rewards on the rewards distributor', async function () {
        const { rariRewardsDistributorDelegator, rariPool8Tribe } = contractAddresses;
        const tribalChief = contracts.tribalChief as TribalChief;

        const elevenTribe = ethers.constants.WeiPerEther.mul('11');
        const tribeReward = await tribalChief.tribePerBlock();

        const contractTx = await tribalChief.updateBlockReward(elevenTribe);
        await contractTx.wait();

        const rewardsDistributorDelegator = await ethers.getContractAt(
          'IRewardsAdmin',
          rariRewardsDistributorDelegator
        );

        const expectedNewCompSpeed = elevenTribe.mul(`${poolAllocPoints}`).div(totalAllocPoint);
        const [newCompSpeed, updateNeeded] = await autoRewardsDistributor.getNewRewardSpeed();
        expect(toBN(newCompSpeed)).to.be.equal(expectedNewCompSpeed);
        expect(updateNeeded).to.be.true;

        await expect(await autoRewardsDistributor.setAutoRewardsDistribution())
          .to.emit(autoRewardsDistributor, 'SpeedChanged')
          .withArgs(expectedNewCompSpeed);

        const actualNewCompSpeed = await rewardsDistributorDelegator.compSupplySpeeds(rariPool8Tribe);
        expect(actualNewCompSpeed).to.be.equal(expectedNewCompSpeed);

        const actualNewCompSpeedRDA = await rewardsDistributorAdmin.compSupplySpeeds(rariPool8Tribe);
        expect(actualNewCompSpeedRDA).to.be.equal(expectedNewCompSpeed);

        // reset
        await tribalChief.updateBlockReward(tribeReward);
      });
    });

    describe('Supply and Claim', async () => {
      it('succeeds when user supplies tribe and then claims', async () => {
        const { erc20Dripper, rariRewardsDistributorDelegator } = contractAddresses;
        const rewardsDistributorDelegator = await ethers.getContractAt(
          'IRewardsAdmin',
          rariRewardsDistributorDelegator
        );

        const signer = await ethers.getSigner(erc20Dripper);
        await hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [erc20Dripper]
        });
        await forceEth(erc20Dripper);

        const { rariPool8Tribe } = contracts;
        const mintAmount = await tribe.balanceOf(erc20Dripper);
        await tribe.connect(signer).approve(rariPool8Tribe.address, mintAmount);

        await rariPool8Tribe.connect(signer).mint(mintAmount);

        const blocksToAdvance = 10;
        for (let i = 0; i < blocksToAdvance; i++) {
          await time.advanceBlock();
        }
        await stakingTokenWrapper.harvest();

        const startingTribeBalance = await tribe.balanceOf(erc20Dripper);
        await rewardsDistributorDelegator.claimRewards(erc20Dripper);
        const endingTribeBalance = await tribe.balanceOf(erc20Dripper);
        expect(endingTribeBalance).to.be.gt(startingTribeBalance);
      });
    });

    describe('Guardian Disables Supply Rewards', async () => {
      it('does not receive reward when supply incentives are moved to zero', async () => {
        const { erc20Dripper, guardianMultisig, rariRewardsDistributorDelegator } = contractAddresses;
        const signer = await getImpersonatedSigner(guardianMultisig);
        const { rariPool8Tribe } = contracts;
        const rewardsDistributorDelegator = await ethers.getContractAt(
          'IRewardsAdmin',
          rariRewardsDistributorDelegator
        );

        await rewardsDistributorAdmin.connect(signer).guardianDisableSupplySpeed(rariPool8Tribe.address);
        expect(await rewardsDistributorDelegator.compSupplySpeeds(rariPool8Tribe.address)).to.be.equal(toBN(0));
        await rewardsDistributorDelegator.claimRewards(erc20Dripper);

        const blocksToAdvance = 10;
        for (let i = 0; i < blocksToAdvance; i++) {
          await time.advanceBlock();
        }

        const startingTribeBalance = await tribe.balanceOf(erc20Dripper);
        await rewardsDistributorDelegator.claimRewards(erc20Dripper);
        const endingTribeBalance = await tribe.balanceOf(erc20Dripper);
        expect(endingTribeBalance).to.be.equal(startingTribeBalance);
      });
    });
  });

  describe('TribalChiefSyncV2', async () => {
    before(async () => {
      const tribalChief = contracts.tribalChief as TribalChief;
      const rewardsDistributorAdmin = contracts.rewardsDistributorAdmin as RewardsDistributorAdmin;
      const autoRewardsDistributor = contracts.autoRewardsDistributor as AutoRewardsDistributor;
      const feiDAOTimelock = contracts.feiDAOTimelock as FeiDAOTimelock;

      const d3AutoRewardsDistributor = contracts.d3AutoRewardsDistributor as AutoRewardsDistributor;
      const fei3CrvAutoRewardsDistributor = contracts.fei3CrvAutoRewardsDistributor as AutoRewardsDistributor;

      const pid = 3;
      const poolAllocPoints = 1000;

      // Fixture: Set Tribe block reward to be greater than 0
      await setupIncentivesFixtures(
        contracts.core as Core,
        tribalChief,
        feiDAOTimelock,
        rewardsDistributorAdmin,
        [autoRewardsDistributor, d3AutoRewardsDistributor, fei3CrvAutoRewardsDistributor],
        pid,
        poolAllocPoints,
        contractAddresses
      );
    });

    it('auto-sync works correctly', async () => {
      const tribalChiefSync: TribalChiefSyncV2 = contracts.tribalChiefSyncV2 as TribalChiefSyncV2;
      const tribalChiefSyncExtension: TribalChiefSyncExtension =
        contracts.tribalChiefSyncExtension as TribalChiefSyncExtension;

      const tribalChief: TribalChief = contracts.tribalChief as TribalChief;

      const { d3AutoRewardsDistributor, fei3CrvAutoRewardsDistributor, rariRewardsDistributorDelegator } = contracts;
      const distributors = [d3AutoRewardsDistributor.address, fei3CrvAutoRewardsDistributor.address];

      if (!(await tribalChiefSync.isRewardDecreaseAvailable())) {
        await time.increaseTo((await tribalChiefSync.nextRewardTimestamp()).add(toBN(1)));
      }

      while (await tribalChiefSync.isRewardDecreaseAvailable()) {
        const nextRewardRate = await tribalChiefSync.nextRewardsRate();
        doLogging && console.log(`Decreasing to ${nextRewardRate.toString()}`);

        expect(await tribalChief.tribePerBlock()).to.not.be.bignumber.equal(nextRewardRate);
        await tribalChiefSyncExtension.autoDecreaseRewards(distributors);
        expect(await tribalChief.tribePerBlock()).to.be.bignumber.equal(nextRewardRate);

        [d3AutoRewardsDistributor, fei3CrvAutoRewardsDistributor].forEach(async (distributor) => {
          const rewardSpeed = await distributor.getNewRewardSpeed();
          expect(rewardSpeed[1]).to.be.false;
          doLogging && console.log(`rewardSpeed: ${rewardSpeed[0]}`);
          expect(rewardSpeed[0]).to.be.equal(
            await rariRewardsDistributorDelegator.compSupplySpeeds(await distributor.cTokenAddress())
          );
        });

        if (nextRewardRate.toString() !== '6060000000000000000') {
          const deadline = (await tribalChiefSync.nextRewardTimestamp()).add(toBN(1)).toNumber();
          const currentTime = await time.latest();
          if (deadline > currentTime) await time.increaseTo(deadline);
        }
      }
      doLogging && console.log(`Done and checking latest`);

      expect(await time.latest()).to.be.greaterThan(1677628800);
    });
  });
});
