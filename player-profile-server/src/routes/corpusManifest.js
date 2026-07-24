const { Router } = require('express');
const { CORPUS_SERVICE_MANIFEST } = require('../corpus/manifest');

const router = Router();

router.get('/', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  return res.json(CORPUS_SERVICE_MANIFEST);
});

module.exports = router;
