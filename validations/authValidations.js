const { supabase } = require('../config/db')
const { body } = require('express-validator')
const UserModel = require('../models/userModel')
const { PasswordValidator } = require('password-validator-pro')

const passwordValidator = new PasswordValidator({
  minLength: 8,
  maxLength: 32,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  combineErrors: true,
});

const validateSignUp = [
  // Email validation
  body('email')
    .trim()
    .normalizeEmail()
    .notEmpty()
    .withMessage('Email is required.')
    .isEmail()
    .withMessage('Please enter a valid email.')
    .custom(async (email, { req }) => {
        const { data, error } = await UserModel.getUserByEmail(email)

        // If user exist with the specified email throw error
        if (data) {
            throw new Error('Email is already in use.')
        }

        return
    }),

  // password and confirmPassword validation
  body('password')
    .trim()
    .custom(async (password, { req }) => {

      // validate a password with spaces
      const noSpacesRule = {
        code: 'NO_SPACES',
        message: 'Password must not contain spaces.',
        validate: (password) => !/\s/.test(password), // Validation logic
      };
      passwordValidator.addCustomRule(noSpacesRule)

      // validate if password does not exist
      if (!password) {
        throw new Error('Password is required.')
      }

      // validate password with rules set in passwordValidator
      const result = passwordValidator.validate(password)

      if (!result.valid) {
        throw new Error(result.errors.map(err => err.message))
      }

      if (password !== req.body.confirmPassword) {
        throw new Error('Password and confirmed password are not the same.')
      }

      return // If all validations pass, do nothing
  }),

  body('username')
    .trim()
    .notEmpty()
    .withMessage('Username is required.')
    .isLength({ min:4, max:20 })
    .withMessage('Username minimum and maximum length is 4 and 20 characters respectively.')
    .isAlphanumeric()
    .withMessage('Username only accepts alphanumeric characters.')
    .custom(async (username, { req }) => {
        if (/\s/.test(username)) {
            throw new Error('Username should not contain spaces.');
        }

        const { data, error } = await UserModel.getUserByEmail(username)

        // If user exist with the specified email throw error
        if (data) {
            throw new Error('Username is already in use.')
        }

        return
    })
]

const validateLogIn = [
  // Email validation
  body('email')
    .trim()
    .normalizeEmail()
    .notEmpty()
    .withMessage('Email is required.')
    .isEmail()
    .withMessage('Please enter a valid email.'),

  // password validation
  body('password')
    .trim()
    .custom(async (password, { req }) => {

      // validate a password with spaces
      const noSpacesRule = {
        code: 'NO_SPACES',
        message: 'Password should not contain spaces.',
        validate: (password) => !/\s/.test(password), // Validation logic
      };
      passwordValidator.addCustomRule(noSpacesRule)

      // validate if password does not exist
      if (!password) {
        throw new Error('Password is required.')
      }

      return // If all validations pass, do nothing
  }),
]

const validateUpdateProfilePassword = [
  // currentPassword, newPassword, confirmNewPassword validation
  body('currentPassword')
    .trim()
    .notEmpty()
    .withMessage("Current password is required.")
    .custom(async (currentPassword, { req }) => {

      // validate a password with spaces
      const noSpacesRule = {
        code: 'NO_SPACES',
        message: 'Password must not contain spaces.',
        validate: (currentPassword) => !/\s/.test(currentPassword), // Validation logic
      };
      passwordValidator.addCustomRule(noSpacesRule)

      // validate if password does not exist
      if (!currentPassword) {
        throw new Error('Password is required.')
      }

      // validate password with rules set in passwordValidator
      const result = passwordValidator.validate(currentPassword)

      if (!result.valid) {
        throw new Error(result.errors.map(err => err.message))
      }

      if (currentPassword === req.body.newPassword) {
        throw new Error('Current password and new password cannot be the same.')
      }

      return // If all validations pass, do nothing
  }),

  body('newPassword')
    .trim()
    .notEmpty()
    .withMessage("A new password is required.")
    .custom(async (newPassword, { req }) => {

      // validate a password with spaces
      const noSpacesRule = {
        code: 'NO_SPACES',
        message: 'Password must not contain spaces.',
        validate: (newPassword) => !/\s/.test(newPassword), // Validation logic
      };
      passwordValidator.addCustomRule(noSpacesRule)

      // validate if password does not exist
      if (!newPassword) {
        throw new Error('Password is required.')
      }

      // validate password with rules set in passwordValidator
      const result = passwordValidator.validate(newPassword)

      if (!result.valid) {
        throw new Error(result.errors.map(err => err.message))
      }

      if (newPassword !== req.body.confirmNewPassword) {
        throw new Error('New password and confirmed new password are not the same.')
      }

      return // If all validations pass, do nothing
  }),
]

const validateUpdateProfileEmail = [
  // Email validation
  body('newEmail')
    .trim()
    .normalizeEmail()
    .notEmpty()
    .withMessage('Email is required.')
    .isEmail()
    .withMessage('Please enter a valid email.')
    .custom(async (email, { req }) => {
        const { data, error } = await UserModel.getUserByEmail(email)

        // If user exist with the specified email throw error
        if (data) {
            throw new Error('Email is already in use.')
        }

        if (email === req.body.currentEmail){
          throw new Error('New email is already the current email.')
        } 

        return
    }),
]

module.exports = { 
  validateSignUp, 
  validateLogIn, 
  validateUpdateProfilePassword, 
  validateUpdateProfileEmail 
}