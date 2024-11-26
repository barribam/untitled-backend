const { supabase } = require('../config/db')

class UserModel {
    // Fetch user by username
    static getUserByUsername = async (username) => {
        const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('username', username)
        .single()

        return { data, error } 
    }

    // Fetch user by email
    static getUserByEmail = async (email) => {
        const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('email', email)
        .single()
        
        return { data, error } 
    }

    static getUsernameByUserID = async (userId) => {
        const {data, error } = await supabase
        .from('user_profiles')
        .select('username')
        .eq('user_id', userId)
        .single()

        return { data, error }
    }

    // Create a new user
    // static createUser = async (userData) => {
    //     const { data, error } = await supabase
    //         .from('users')
    //         .insert([userData])
        
    //     return { data, error } 
    // }

    // Update user information
    static updateUser = async (userId, updates) => {
        const { data, error } = await supabase
            .from('user_profiles')
            .update(updates)
            .eq('id', userId)
        
        return { data, error }
    }

    static signUp = async (email, password, username) => {
        // Check if there is existing user with requested username
        const { data, error } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('username', username.trim())
            .single()


        if (data) {
            return { error: 'Username is already taken.'}
        }

        const { data: userData, error: signUpError } = await supabase.auth.signUp({
            email: String(email).trim().toLowerCase(),
            password: String(password).trim(),
        });
    
        if (signUpError) {
            return { error: signUpError.message }
        }
    
        if (!userData || !userData.user) {
            return { error: 'Sign up failed. User data is missing.' };
        }
    
        // Insert user profile
        const { data: profileData, error: profileError } = await supabase
            .from('user_profiles')
            .insert([{
                user_id: userData.user.id,
                username: username.trim(),
            }]);
    
        if (profileError) {
            return { error: profileError.message };
        }

        console.log({profileData, userData})
        return { success: true, user:userData.user }
    }

    static logIn = async (email, password) => {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password,
        })

        return { data, error }
    }
}

module.exports = UserModel