/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  packagerConfig: {
    name: 'FAIRWallet',
    executableName: 'fairwallet',
    icon: './assets/icon',
    appBundleId: 'in.fairco.wallet',
    asar: true,
    extraResource: ['./dist'],
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'fairwallet',
        setupIcon: './assets/icon.ico',
      },
    },
    {
      name: '@electron-forge/maker-dmg',
      config: {
        name: 'FAIRWallet',
        icon: './assets/icon.icns',
        format: 'ULFO',
      },
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          name: 'fairwallet',
          productName: 'FAIRWallet',
          genericName: 'FairCoin Wallet',
          description: 'Lightweight SPV wallet for FairCoin',
          categories: ['Finance', 'Network'],
          icon: './assets/icon.png',
          maintainer: 'FairCoin',
          homepage: 'https://fairco.in',
        },
      },
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {
        options: {
          name: 'fairwallet',
          productName: 'FAIRWallet',
          description: 'Lightweight SPV wallet for FairCoin',
          icon: './assets/icon.png',
          categories: ['Finance', 'Network'],
          homepage: 'https://fairco.in',
        },
      },
    },
  ],
};
