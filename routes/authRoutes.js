const express = require('express')
const authController = require('../controllers/authController')
const authValidations = require('../validations/authValidations')
const authMiddleware = require('../middleware/authMiddleware')

const router = express.Router()

router.post('/signup', authValidations.validateSignUp, authController.signUp)
router.post('/signout', authController.signOut)
router.post('/login',  authValidations.validateLogIn, authController.logIn)

// user profile data
router.get('/user-profile', authMiddleware.extractJwtFromHeader, authMiddleware.verifyJwt, authController.userProfile)
router.patch('/user-profile/password', authMiddleware.extractJwtFromHeader, authMiddleware.verifyJwt, authValidations.validateUpdateProfilePassword, authController.updateProfilePassword)
router.patch('/user-profile/email', authMiddleware.extractJwtFromHeader, authMiddleware.verifyJwt, authValidations.validateUpdateProfileEmail, authController.updateProfileEmail)
router.post('/reset-password', authController.resetPassword)

module.exports = router