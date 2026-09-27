const express = require('express');
const { register, login } = require('../controllers/auth.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

// Solo un admin puede dar de alta usuarios del personal. El primer admin sale
// del seed.sql de Jarrison, no de este endpoint.
router.post('/register', requireAuth, requireRole('admin'), register);
router.post('/login', login);

module.exports = router;
