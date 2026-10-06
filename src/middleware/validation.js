const { body, param, query } = require('express-validator');
const { validationResult } = require('express-validator');

// Middleware to check validation results
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: {
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: errors.array().map((e) => ({ field: e.path, message: e.msg })),
      },
    });
  }
  next();
}

const mongoIdRules = [
  param('id').isMongoId().withMessage('Invalid resource ID format'),
];

const createContactRules = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('phone').trim().notEmpty().withMessage('Phone number is required'),
  body('email').optional({ checkFalsy: true }).trim().isEmail().withMessage('Invalid email format'),
  body('notes').optional().trim(),
];

const updateContactRules = [
  param('id').isMongoId().withMessage('Invalid contact ID'),
  body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
  body('email').optional({ checkFalsy: true }).trim().isEmail().withMessage('Invalid email format'),
  body('notes').optional({ nullable: true }).trim(),
  body('status').optional().isIn(['active', 'archived', 'deleted']).withMessage('Invalid status'),
];

const paginationRules = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
];

module.exports = {
  validate,
  mongoIdRules,
  createContactRules,
  updateContactRules,
  paginationRules,
};
