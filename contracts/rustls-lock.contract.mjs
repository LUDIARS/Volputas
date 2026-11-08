export default {
  post: (result) => result.version === '0.23.46'
    && result.checksum === '48e13bd8c0e9365c43cfa5c9e8f9ad49d3c8444926c9aac819e0e4dc503c8fdf'
    && result.onlyRustlsChanged
    && result.manifestUnchanged,
};
