export default {
  post: (result) => result.bodyParserRange === '~6.16.0'
    && result.entry.version === '6.16.2'
    && result.entry.resolved === 'https://registry.npmjs.org/qs/-/qs-6.16.2.tgz'
    && result.entry.integrity === 'sha512-VYdnB5S7/0IeXzBacUtwNAaM6d7Y/PgYnNC7bJCI6meqA/OgnsQbZMtVW8Dt2D1PHgbHGtYmhSoEIgvt7xZ2ZA=='
    && result.expressRange === '~6.15.1'
    && result.retained.version === '6.15.3'
    && result.retained.resolved === 'https://registry.npmjs.org/qs/-/qs-6.15.3.tgz'
    && result.retained.integrity === 'sha512-O9gl3zCl5h5blw1KGUzQKhA5oUXSl8rwUIM5o0S3nCXMliSvy5Dzx7/DJcI+SwgICv+IneSZwhBh1oSyEHA71A==',
};
