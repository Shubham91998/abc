import { asyncHandler } from "../utils/asyncHandler.js";
import {ApiError} from "../utils/ApiError.js";
import {User} from "../models/user.model.js";
import {ApiResponse} from "../utils/ApiResponse.js"
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import jwt from "jsonwebtoken";

const generateAccessAndRefrenceTokens = async(userId)=>{
    try {
        const user = await User.findById(userId)
        const accessToken = user.generateAccessTocken()
        const refreshToken = user.generateRefreshToken()

        user.refreshToken = refreshToken
        await user.save({validateBeforeSave: false})
        return {accessToken, refreshToken}

    } catch (error) {
        throw new ApiError(500,"Somthing went wrong while generate refresh and access token");
        
    }
}


const registerUser = asyncHandler(async (req, res) => {
    // get user details from frontend
    // validation - not empty
    // check if user already exist: username, email
    // check for image , check for avatar
    // upload them to cloudnary, avatar
    // create user object - create entry in db
    // remove password and refresh token field from response
    // check for user creation
    // return res

    
    const {fullname, username, email, password} = req.body
    //console.log(req.body)

    if (
        [username, email, fullname, password].some((field) => field?.trim()==="")
    ) {
        throw new ApiError(400, "All fields are required.");
        
    }

    const existedUser = await User.findOne({
        $or:[{ username },{ email }]
    })
    if (existedUser){
        throw new ApiError(409, "User with email or username already exist");
        
    }
    //console.log(req.files);

    const avatarLocalPath = req.files?.avatar[0]?.path;
    //const coverImageLocalPath = req.files.coverImage[0]?.path;

    let coverImageLocalPath;
    if (req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0){
        coverImageLocalPath = req.files.coverImage[0].path;
    }

    if(!avatarLocalPath){
        throw new Error(400,"Avatar file is required.");
        
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath)
    const coverImage = await uploadOnCloudinary(coverImageLocalPath)

    if (!avatar) {
        throw new Error(400,"Avatar file is required.");
    }

    const user = await User.create({
        fullname,
        avatar: avatar.url,
        coverImage:coverImage?.url || "",
        email,
        password,
        username: username.toLowerCase()
    })

    const createdUser = await User.findById(user._id).select(
        "-password -refreshToken"
    )
    if (!createdUser) {
        throw new Error(500, "Somthing went wrong while registring the user");
    }

    return res.status(201).json(
        new ApiResponse(200, createdUser, "User registered successfully")
    )


})

const loginUser = asyncHandler(async (req, res) => {
    // req body -> data
    // username or email -> verify
    // find user
    // password check
    // access and refresh token
    // send cookies 
    const {email, username, password} = req.body;
    if (!username && !email) {
        throw new ApiError(400, "username or password is required")
        
    }
    const user = await User.findOne({
        $or:[{username}, {email}]
    })
    if (!user) {
        throw new ApiError(404,"User does not exist");
    }
    const isPasswordValid = await user.isPasswordCorrect((password))
    if (!isPasswordValid) {
        throw new ApiError(401,"Invalid user credentials");
    }

    const {refreshToken, accessToken} = await generateAccessAndRefrenceTokens(user._id)

    const loggedInUser = await User.findById(user._id).select("-password -refreshToken")

    const options = {
        httpOnly : true,
        secure: true
    }
    return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
        new ApiResponse(
            200,
            {
                user: loggedInUser, accessToken, refreshToken
            },
            "User logged In successfully"
        )
    )

})

const logOutUser = asyncHandler(async(req, res) => {
    await User.findByIdAndUpdate(req.user._id,{
        $set:{
            refreshToken: undefined
        },
        
    },
    {
        new:true
    })
    const options = {
        httpOnly : true,
        secure: true
    }
    return res.status(200).clearCookie("accessToken", options).clearCookie("refreshToken", options)
    .json(new ApiResponse(200, {}, "User logOut successful"))
})

const refreshAccessToken = asyncHandler(async(req, res) => {
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken

    if (!incomingRefreshToken) {
        throw new ApiError(401, "unauthorized request")
    }

    try {
        const decodedToken = jwt.verify(
            incomingRefreshToken,
            process.env.REFRESH_TOKEN_SECRATE
        )
        const user = User.findById(decodedToken?._id)
    
        if (!user) {
            throw new ApiError(401, "Invalid refresh token")
        }
    
        if (incomingRefreshToken !== user?.refreshToken) {
            throw new ApiError(401, "refresh token is expired or used")
    
        }
    
        const options = {
            httpOnly: true,
            secure:true
        }
    
        const {accessToken, newRefreshToken} = await generateAccessAndRefrenceTokens(user._id)
    
        return res.status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", newRefreshToken, options)
        .json(
            new ApiResponse(
                200,
                {accessToken, refreshToken: newRefreshToken},
                "Access token refreshed"
            )
        )
    
    } catch (error) {
        throw new ApiError(401, error?.message || "Invalid refresh token")
    }

})

const changeCurrentPassword = asyncHandler(async(req, res) => {
    const {oldPassword, newPassword} = req.body;

    const user = User.findById(req.user?._id)

    const isPasswordCoorrect = await user.isPasswordCorrect(oldPassword)
    if (!isPasswordCoorrect){
        throw new ApiError(400, "Invalid Old Password");

    }

    user.password = newPassword;
    await user.save({validateBeforeSave: false})
    return res.status(200).json(new ApiResponse(200, {}, "password change sucessfull"))

})

const getCurrentUser = asyncHandler(async(req, res) => {
    return res.status(200)
    .json(200, req.user, "Current user successfully")
})

const updateAcountDetails = asyncHandler(async (req, res) => {
    const {fullname, email} = req.body;
    if ((!fullname || !email)) {
        throw new ApiError(400,"All fields are required");
        
    }

    const user = User.findByIdAndUpdate(
        req.user?._id,
        {
            $set:{
                fullname:fullname,
                email:email
            }
        },
        {new:true}
    ).select("-password")
    return res.status(200)
    .json(new ApiResponse(200,user, "Account details update sucessfully" ))
})


const updataUserAvatar = asyncHandler(async (req, res) => {
    const avatarLocalPath = req.file?.path

    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar file is missing");
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath)

    if (!avatar.url) {
        throw new ApiError(400, "Error while uploading on avatar");

    }
    const user = await User.findByIdAndUpdate(req.user?._id,
        {
            $set:{
                avatar:avatar.url
            }
        },
        {new:true}

    ).select("-password")
    return res
    .status(200)
    .json(new ApiResponse(200, user, "Avatar image updated sucessfully"))
})

const updateUserCoverImage = asyncHandler(async (req, res) => {
    const coverImageLocalPath = req.file?.path

    if (!coverImageLocalPath) {
        throw new ApiError(400, "Cover Image file is missing");
    }

    const coverImage = await uploadOnCloudinary(coverImageLocalPath)

    if (!coverImage.url) {
        throw new ApiError(400, "Error while uploading on image");

    }
    const user = await User.findByIdAndUpdate(req.user?._id,
        {
            $set:{
                coverImage:coverImage.url
            }
        },
        {new:true}

    ).select("-password")
    return res
    .status(200)
    .json(new ApiResponse(200, user, "Cover image updated sucessfully"))
})




export {
    registerUser,
    loginUser, 
    logOutUser, 
    refreshAccessToken, 
    changeCurrentPassword, 
    getCurrentUser, 
    updateAcountDetails,
    updataUserAvatar,
    updateUserCoverImage
}