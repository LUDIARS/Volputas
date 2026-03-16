function validate(schema) {
  return (req, res, next) => {
    const errors = [];

    if (schema.body) {
      const bodyErrors = validateObject(req.body, schema.body, 'body');
      errors.push(...bodyErrors);
    }

    if (schema.params) {
      const paramErrors = validateObject(req.params, schema.params, 'params');
      errors.push(...paramErrors);
    }

    if (schema.query) {
      const queryErrors = validateObject(req.query, schema.query, 'query');
      errors.push(...queryErrors);
    }

    if (errors.length > 0) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: errors.join('; '),
        },
      });
    }

    next();
  };
}

function validateObject(data, rules, location) {
  const errors = [];
  if (!data) data = {};

  for (const [field, rule] of Object.entries(rules)) {
    const value = data[field];

    if (rule.required && (value === undefined || value === null || value === '')) {
      errors.push(`${location}.${field} is required`);
      continue;
    }

    if (value === undefined || value === null) continue;

    if (rule.type === 'string' && typeof value !== 'string') {
      errors.push(`${location}.${field} must be a string`);
    }

    if (rule.type === 'uuid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      errors.push(`${location}.${field} must be a valid UUID v4`);
    }

    if (rule.type === 'array' && !Array.isArray(value)) {
      errors.push(`${location}.${field} must be an array`);
    }

    if (rule.type === 'object' && (typeof value !== 'object' || Array.isArray(value))) {
      errors.push(`${location}.${field} must be an object`);
    }

    if (rule.maxLength && typeof value === 'string' && value.length > rule.maxLength) {
      errors.push(`${location}.${field} must be at most ${rule.maxLength} characters`);
    }

    if (rule.enum && !rule.enum.includes(value)) {
      errors.push(`${location}.${field} must be one of: ${rule.enum.join(', ')}`);
    }
  }

  return errors;
}

module.exports = { validate };
