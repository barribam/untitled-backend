const UserModel = require('../models/userModel')
const { supabase } = require('../config/db')
const { validationResult } = require('express-validator')

const signUp = async (req, res) => {
  //Express validator lib uses validationResult() from custom validateRegistration in authValidations.js
  const errors = validationResult(req)

  if(!errors.isEmpty()){

    const formattedErrors = {}

    errors.array().map(err => {
      formattedErrors[err.path] = err.msg
    })

    console.log(formattedErrors)

    // Return validation errors as JSON
    return res.status(400).json({
      success: false,
      errors: formattedErrors
    })
  }

  const { username, email, password } = req.body;

  try {
    const { error, success } = await UserModel.signUp(
      email,
      password,
      username,
    )

    if (error) {
      return res.status(400).json({ 
        success: false, 
        error: error 
      })
    }

    res.status(201).json({
      success: true,
      message: `User ${username} created successfully!` 
    })

  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    })
  }
};

const signOut = async (req, res) => {
  try {
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.log('Error signing out:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to sign out',
      });
    }

    // TODO clear user related data here

    return res.status(200).json({
      success: true,
      message: 'Signed out successfully',
    });
  } catch (err) {
    console.log('Unexpected error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
    });
  }
}

const logIn = async (req, res) => {
  const errors = validationResult(req)

  if(!errors.isEmpty()){

    const formattedErrors = {}

    errors.array().map(err => {
      formattedErrors[err.path] = err.msg
    })

    console.log(formattedErrors)

    // Return validation errors as JSON
    return res.status(400).json({
      success: false,
      errors: formattedErrors
    })
  }


  const { email, password } = req.body

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    })

    if (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
    console.log(data)
    res.status(201).json({
      success: true,
      message: `Logged in successfully!` 
    })

  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message 
    })
  }
}

const updateProfilePassword = async (req, res) => {
  //Express validator lib uses validationResult() from custom validateRegistration in authValidations.js
  const errors = validationResult(req)

  if(!errors.isEmpty()){

    const formattedErrors = {}

    errors.array().map(err => {
      formattedErrors[err.path] = err.msg
    })

    console.log(formattedErrors)

    // Return validation errors as JSON
    return res.status(400).json({
      success: false,
      errors: formattedErrors
    })
  }

  const { currentEmail, currentPassword, newPassword } = req.body;
  const token = req.token

  try {
    const { data: user_data, error: error_data  } = await supabase.auth.getUser(token)

    if(error_data){
      throw new Error(error.message)
    }

    const userId = user_data.user.id

    // First verify the current password
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: currentEmail, // current email from user's session
      password: currentPassword
    })

    if (signInError) {
      return res.status(400).json({
        error: "Current password is incorrect."
      })
    }

    const { data, error } = await supabase.auth.admin.updateUserById(
      userId,
      { password: newPassword }
    )

    if (error) {
      return res.status(400).json({
        error: error.message
      })
    }

    res.status(200).json({
      message: "Your password has changed successfully!",
      data
    })

  } catch (error) {
    res.status(500).json({
      error: "An error occurred while updating your password."
    })
  }
}

const updateProfileEmail = async (req, res) => {
  //Express validator lib uses validationResult() from custom validateRegistration in authValidations.js
  const errors = validationResult(req)

  if(!errors.isEmpty()){

    const formattedErrors = {}

    errors.array().map(err => {
      formattedErrors[err.path] = err.msg
    })

    console.log(formattedErrors)

    // Return validation errors as JSON
    return res.status(400).json({
      success: false,
      errors: formattedErrors
    })
  }

  const { newEmail: newEmail, currentPassword: currentPassword } = req.body;
  const token = req.token

  try {
    const { data: user_data, error: error_data  } = await supabase.auth.getUser(token)

    if (error_data) {
      throw new Error(error_data.message)
    }

    const userId = user_data.user.id

    // Update the email
    const { data, error } = await supabase.auth.admin.updateUserById(
      userId,
      { email: newEmail }
    );

    if (error) {
      return res.status(400).json({
        error: error.message
      });
    }

    res.status(200).json({
      message: "Email update request sent successfully.",
      data
    });

  } catch (error) {
    console.error("Server error during email update:", error);
    res.status(500).json({
      error: "An error occurred while updating email."
    });
  }
}

const userProfile = async (req, res) => {
  const token = req.token

  try {
    const { data: data  } = await supabase.auth.getUser(token)
    const userId = data.user.id

    // Fetch username from the user_profiles table
    const { data: profileData, error: profileError } = await supabase
      .from('user_profiles')
      .select('username')
      .eq('user_id', userId)
      .single();

    if (profileError) {
      throw profileError;
    }
  
    // Fetch email from auth.users using the administrative API
    const { data: { user: authData }, error: authError } = await supabase
    .auth.admin.getUserById(userId);
    console.log(authData)
    
    if (authError) {
      throw authError;
    }
  
    // Check if either data is not found
    if (!profileData || !authData) {
      return res.status(404).json({ 
        success: false, 
        error: 'User profile or authentication data not found.' 
      });
    }
    console.log(profileData)
  
    // Combine the data and send it in the response
    res.status(200).json({
      email: authData.email,
      username: profileData.username,
    });

  } catch (error) {

    console.error('Error fetching profile data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch profile data.'
    });
  }
}

const resetPassword = async (req, res) => {
  // TODO Validate if email exists in DB
  const email = req.body.email 

  const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: "http://localhost:5173/signup"
  });

  if (error) {
      console.log(error.message)
      return res.status(500).json({
        success: false,
        message: error.message
      })
  }

  res.status(200).json({
    success: true,
    message: 'A recovery password email has been sent!'
  })
  console.log("Recovery email sent:", data);
}


module.exports = { 
  signUp, 
  signOut, 
  logIn, 
  updateProfilePassword, 
  updateProfileEmail, 
  userProfile,
  resetPassword,
}
