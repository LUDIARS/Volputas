export default {
  post: ({ state, status }) => (
    state === (status >= 200 && status < 300 ? 'delivered'
      : status >= 400 && status < 500 ? 'refused' : 'pending')
  ) || 'Only 2xx and 4xx may end delivery attempts',
};
