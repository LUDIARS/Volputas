const path = require('node:path');

module.exports = {
  packagerConfig: {
    asar: true,
    executableName: 'Volputas',
    extraResource: [
      path.join(__dirname, 'desktop', 'setup-samples'),
    ],
    ignore: [
      /^\/out(?:\/|$)/,
      /^\/coverage(?:\/|$)/,
      /^\/frontend\/node_modules(?:\/|$)/,
      /\.test\.js$/,
    ],
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        name: 'Volputas',
        authors: 'LUDIARS',
        description: 'Local-only survey desktop tool for Git-backed VolputasData',
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'linux'],
      config: {},
    },
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'LUDIARS',
          name: 'Volputas',
        },
        draft: true,
        prerelease: false,
        generateReleaseNotes: true,
      },
    },
  ],
};
