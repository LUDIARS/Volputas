// Contract C-4: the scheduler hands back a stop function like sessionMaintenance.
module.exports = {
  post: (result) => typeof result === 'function' || 'startDiscutereImpressionPush must return a stop function',
};
