import express from 'express';
import mongoose from 'mongoose';
import 'dotenv/config'
import bcrypt from 'bcrypt'; 
import User from './Schema/User.js';
import Blog from './Schema/Blog.js';
import { nanoid } from 'nanoid';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import admin from "firebase-admin";
//import serviceAccountKey from "./react-js-blog-website-d77e5-firebase-adminsdk-fjers-c3aa403e5d.json" assert { type: "json" }
import {getAuth, UserRecord} from "firebase-admin/auth"
import dns from 'dns';
import multer from 'multer';
import cloudinary  from 'cloudinary';
import Notification from "./Schema/Notification.js";
import Comment from "./Schema/Comment.js";
import { populate } from 'dotenv';
import { error } from 'console';
import { title } from 'process';

dns.setServers(['8.8.8.8', '8.8.4.4']); // Google DNS

//const cloudinary = require('cloudinary').v2;

 const server = express();
 let PORT = 3000;

 const ITEMS_PER_PAGE = 10;

// admin.initializeApp({
  //  credential: admin.credential.cert(serviceAccountKey)

// });

 let emailRegex = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/; // regex for email
let passwordRegex = /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).{6,20}$/; // regex for password
 server.use(express.json());
 server.use(cors({
origin: 'https://frontend-kn2qltiv8-harshithas-projects-90df70de.vercel.app/', // Replace with your frontend URL
   credentials: true,}));

 
 mongoose.connect(process.env.DB_LOCATION, {autoIndex: true})

 const formatDatatoSend = (user) => {

    const access_token = jwt.sign({ id: user._id, admin: user.admin }, process.env.SECRET_ACCESS_KEY);

    return {
        access_token,
        profile_img: user.personal_info.profile_img,
        username: user.personal_info.username,
        fullname: user.personal_info.fullname,
        isAdmin: user.admin
    };

 };

 const verifyJWT=(req,res,next)=>{
  const authHeader=req.headers['authorization'];
  const token=authHeader && authHeader.split(" ")[1];

  if(token==null){
    return res.status(401).json({error:"No access token"})
  }
  jwt.verify(token, process.env.SECRET_ACCESS_KEY,(err,user)=>{
    if(err){
      return res.status(403).json({error: "Access token is invalid"})
    }
    req.user=user.id
    req.admin = user.admin
    next()
  })
}

 const generateUsername = async (email) => {

    let username =email.split("@")[0];

    let usernameExists = await User.exists({"personal_info.username": username }).then((result) => result)

    usernameExists ? username += nanoid().substring(0, 5) : "";

    return username;
 };

 server.post("/signup", async (req, res) => {
    
    let { fullname, email, password } = req.body;

    //validating data from frontend
    if(fullname.length < 3) {
        return res.status(403).json({"error": "Fullname must be atleast 3 letters long" })
    }
    if(!email.length){
        return res.status(403).json({"error":"Enter the email"})
       }
       if(!emailRegex.test(email)){
        return res.status(403).json({"error":"Email is invalid"})
       }
       if(!passwordRegex.test(password)){
        return res.status(403).json({"error":"Password should be 6 to 20 character long with a numeric ,1 lowercase and 1 uppercase letters"})
       }

       try {
        const hashed_password = await bcrypt.hash(password, 10);
        const username = await generateUsername(email);

        const newUser = new User({
            personal_info: {
                fullname,
                email,
                password: hashed_password,
                username,
                profile_img: 'https://api.dicebear.com/6.x/fun-emoji/svg?seed=Garfield'
            }
        });

        const savedUser = await newUser.save();
        const userData = formatDatatoSend(savedUser);

        return res.status(200).json(userData);
    } catch (error) {
        console.error('Signup error:', error);
        return res.status(500).json({ "error": "Internal Server Error" });
    }
});


 server.post("/signin", (req, res) => {
    let {email, password} = req.body;
    User.findOne({"personal_info.email": email})
    .then((user) => {
        if(!user){
            return res.status(403).json({"error": "Email not found"});
        }

        if(!user.google_auth){

            bcrypt.compare(password, user.personal_info.password, (err, result) => {

                if(err) {
                    return res.status(403).json({"error": "Error occured while login Please try again"})
                }
            
                if(!result){
                    return res.status(403).json({"error": "Incorrect password"})
             
                } else {
                    const userData = formatDatatoSend(user);
                    return res.status(200).json(userData);
                    }
            
            });
                   

        } else {
            return res.status(403).json({"error": "Account was created using google. Try logging in with google."})
        }


        
    })
    .catch(err =>{
        console.log(err.message);
        return res.status(500).json({"error": err.message})
    });
 });


 server.post("/google-auth", async (req, res) => {
    let {access_token} = req.body;
    getAuth()
    .verifyIdToken(access_token)
    .then(async (decodedUser) => {

        let {email, name, picture } = decodedUser;

        picture = picture.replace("s96-c", "s384-c");

        let user = await User.findOne({"personal_info.email": email}).select("personal_info.fullname personal_info.username personal_info.profile_img google_auth").then((u) =>{
            return u || null
        })
        .catch(err => {
            return res.status(500).json({"error": err.message})
        })

        if(user) {
            if(!user.google_auth) {
                return res.status(403).json({"error": "This email was signed up without google. Please Login with password to access the account"})
            }
        }
        else {
            let username = await generateUsername(email);

            user = new User({
                personal_info: {fullname: name, email, profile_img: picture, username},
                google_auth: true
            })
            await user.save().then((u)=> {
                user=u;
            })
            .catch(err => {
                return res.status(500).json({"error": err.message})
            })
        }
        return res.status(200).json(formatDatatoSend(user))

    })
    .catch(err => {
        return res.status(500).json({"error": "Failed to authenticate you with google. Try with some other google account"})
    })
 })

 server.post('/create-blog',verifyJWT,(req,res)=>{

  let authorId= req.user;
  let {title,des,banner,tags,content,draft,wordCount,readingTime,id }=req.body;

  // console.log('Received blog data:', { title, des, banner, tags, content, draft, wordCount,readingTime });


  if(!title.length){
    return res.status(403).json({error: "Provide a title for the blog"})
  }

  if(!draft){
    if(!des.length||des.length>200){
      return res.status(403).json({error: "Provide blog description under 200 characters"})
    }
    if(!banner.length){
      return res.status(403).json({error:"Provide a blog banner to publish"})
    }
    if(!content.blocks.length) {
      return res.status(403).json({error:"Provide blog content to publish"})
    }
    if(!tags.length||tags.length>10){
      return res.status(403).json({error:"Provide tags upto 10 in order to publish the blog"})
    }
  }

  tags=tags.map(tag=>tag.toLowerCase());

  let blog_id=id || title.replace(/[^a-zA-Z0-9]/g,' ').replace(/\s+/g,"-").trim()+nanoid();
  
  if(id){
    Blog.findOneAndUpdate({ blog_id }, { title, des, banner, content, tags, draft: draft ? draft: false})
    .then(() => {
      return res.status(200).json({ id: blog_id });
    })
    .catch(err => {
      return res.status(500).json({ error: err.message})
    })
  }else{

    let blog= new Blog({
      title, des,banner,content,tags, author: authorId, blog_id,draft: Boolean(draft)
    })
    blog.save().then(blog=>{
    let incrementVal=draft?0: 1;

    User.findOneAndUpdate({_id: authorId},{$inc: {"account_info.total_posts": incrementVal}, $push: {"blogs": blog._id}})
    .then(user=>{
      return res.status(200).json({id: blog.blog_Id})
    })
    .catch(err=>{
      return res.status(500).json({error:"Failed to update total posts number"})
    })
  })
  .catch(err=>{
    return res.status(500).json({error: err.message})
  })
  }
})

server.post('/latest-blogs',(req,res)=>{
  let {page} =req.body;
  let maxLimit=5;
  Blog.find({draft :false})
  .populate("author","personal_info.profile_img personal_info.username personal_info.fullname -_id")
  .sort({"publishedAt":-1 })
  .select("blog_id title des banner activity tags publishedAt -_id readingTime")
  .skip((page-1)*maxLimit)
  .limit(maxLimit)
  .then(blogs=>{
    return res.status(200).json({blogs})
  })
  .catch(err=>{
    return res.status(500).json({error: err.message})
  })
})

server.post("/all-latest-blogs-count",(req,res)=>{
  Blog.countDocuments({draft:false})
  
  // Blog.countDocument({draft:false})
   
  .then(count =>{
    return res.status(200).json({totalDocs: count})
  })
  .catch(err=>{
    console.log(err.message);
    return res.status(500).json({error:err.message})
  })
})

// trending blogs

server.get("/trending-blogs",(req,res)=>{
  Blog.find({draft :false})
  .populate("author","personal_info.profile_img personal_info.username personal_info.fullname -_id")
  .sort({"activity.total_read": -1,"activity.total_likes":-1,"publishedAt":-1})
  .select("blog_id title publishedAt -_id")
  .limit(8)
  .then(blogs=>{
    return res.status(200).json({ blogs })
  })
  .catch(err=>{
    return res.status(500).json({error: err.message})
  })

})


//search blog
server.post("/search-blogs",(req,res)=>{
  let{tag,query,page,author,limit,eliminate_blog} =req.body;

  let findQuery;
  if(tag){
    findQuery ={tags:tag,draft:false, blog_id: {$ne: eliminate_blog}};
  }else if(query){
    findQuery={draft:false,title: new RegExp(query,'i') }
  }
  else if(author){
    findQuery ={author,draft:false}
  }
  
  let maxLimit = limit ? limit : 2;

  Blog.find(findQuery)
  .populate("author","personal_info.profile_img personal_info.username personal_info.fullname -_id")
  .sort({"publishedAt":-1})
  .select("blog_id title des banner activity tags publishedAt -_id")
  .skip((page-1)*maxLimit)
  .limit(maxLimit)
  .then(blogs =>{
    return res.status(200).json({blogs})
  })
  .catch(err =>{
    return res.status(500).json({error:err.message})
  })
})

//search-blog-count

server.post("/search-blogs-count",(req,res)=>{
  let {tag, query, author} = req.body;


let findQuery;
if(tag){
  findQuery ={tags:tag, draft:false};
}else if(query){
  findQuery={draft:false,title: new RegExp(query,'i') }
} else if(author){
  findQuery ={author,draft:false}
}


  Blog.countDocuments(findQuery)
  .then(count =>{
    return res.status(200).json({totalDocs:count})
  })
  .catch(err =>{
    return res.status(500).json({error:err.message})
  })
})

//search -users

server.post("/search-users",(req,res)=>{
  let {query}=req.body;
  User.find({"personal_info.username": new RegExp(query,'i')})
  .limit(50)
  .select("personal_info.fullname personal_info.username personal_info.profile_img -_id")
  .then(users=>{
    return res.status(200).json({users})
  })
  .catch(err=>{
    return res.status(500).json({error:err.message})
  })
})

//get profile

server.post("/get-profile",(req,res)=>{
  let {username}=req.body;
  User.findOne({"personal_info.username":username})
.select("-personal_info.password -google_auth -updatedAt -blogs")
.then(user=>{
  return res.status(200).json(user)
})
.catch(err=>{
  console.log(err);
  return res.status(500).json({error:err.message})
})
})


//let PORT = 5000;

cloudinary.config({
  cloud_name: 'dlnmvdrjy',
  api_key: '997119448933813',
  api_secret: 'mt7V_OK_dvIOuN_-xoIujbnMEO0'
});

/*server.post('/upload', async (req, res) => {
  try {
    const result = await cloudinary.uploader.upload(req.file.path);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Failed to upload image' });
  }
});*/

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); // Ensure this directory exists
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

server.post('/upload', upload.single('image'), async (req, res) => {
  try {
    const result = await cloudinary.uploader.upload(req.file.path);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Failed to upload image' });
  }
});


server.post("/get-blog", (req,res) => {
  let { blog_id, draft, mode} = req.body;
  let incrementVal = mode != 'edit' ? 1 : 0;
  Blog.findOneAndUpdate({ blog_id}, {$inc : { "activity.total_reads": incrementVal } })
  .populate("author", "personal_info.fullname personal_info.username personal_info.profile_img")
  .select("title des content banner activity publishedAt blog_id tags")
  .then(blog => {

    User.findOneAndUpdate({ "personal_info.username": blog.author.personal_info.username}, {
      $inc : { "account_info.total_reads": incrementVal }
    })
    .catch(err => {
      return res.status(500).json({ error: err.message })
    })
    if(blog.draft && !draft){
      return res.status(500).json({ error: 'you can not access draft blogs'})
    }
    return res.status(200).json({ blog });
  })
  // .catch(err => {
  //   return res.status(500).json({ error: err.message });
  // })
})

server.post("/like-blog", verifyJWT, (req, res) => {

  let user_id = req.user;

  let { _id, islikedByUser } = req.body;
  let incrementVal = !islikedByUser ? 1 : -1;

  Blog.findOneAndUpdate({ _id}, { $inc: { "activity.total_likes": incrementVal }})
  .then(blog => {
    if(!islikedByUser){
      let like = new Notification({
        type: "like",
        blog: _id,
        notification_for: blog.author,
        user: user_id
      })

      like.save().then(notification => {
        return res.status(200).json({ liked_by_user: true})
      })
    } else{
      Notification.findOneAndDelete({ user: user_id, blog: _id, type: "like"})
      .then(data => {
        return res.status(200).json({ liked_by_user: false })
      })
      .catch(err => {
        return res.status(500).json({ error: err.message})
      })
    }
  })
}) 

server.post("/isliked-by-user", verifyJWT, (req,res) => {
  let user_id = req.user;
  let { _id } = req.body;
  Notification.exists({ user: user_id, type: "like", blog: _id})
  .then(result => {
    return res.status(200).json({ result })
  })
  .catch(err => {
    return res.status(500).json({ error: err.message})
  })
})

server.post("/add-comment", verifyJWT, (req, res) => {

  let user_id = req.user;

  let { _id, comment, blog_author, replying_to, notification_id } = req.body;

  if (!comment.length) {
    return res.status(403).json({ error: 'Write something to leave a comment' });
  }

  //creating a comment doc
  let commentObj =  {
    blog_id: _id, blog_author, comment, commented_by: user_id, 
  }

  if (replying_to) {
    commentObj.parent = replying_to;
    commentObj.isReply = true;
  }

  new Comment(commentObj).save().then(async commentFile => {

    let { comment, commentedAt, children } = commentFile;

    Blog.findOneAndUpdate({ _id }, { $push: { "comments": commentFile._id }, $inc: { "activity.total_comments": 1, "activity.total_parent_comments": replying_to ? 0 : 1 },  })
      .then(blog => { console.log('New comment created') });
    
    let notificationObj = {
      type: replying_to ? "reply" : "comment",
      blog: _id,
      notification_for: blog_author,
      user: user_id,
      comment: commentFile._id
    }

    if (replying_to) {
      notificationObj.replied_on_comment = replying_to;

      await Comment.findOneAndUpdate({ _id: replying_to }, { $push: { children: commentFile._id } })
        .then(replyingToCommentDoc => { notificationObj.notification_for = replyingToCommentDoc.commented_by })
      
        if(notification_id){
          Notification.findOneAndUpdate({ _id: notification_id }, { reply: commentFile._id })
          .then(notification => console.log('notification updated'))
        }

    }

    new Notification(notificationObj).save().then(notification => console.log('new notification created'));

    return res.status(200).json({
      comment, commentedAt, _id: commentFile._id, user_id, children
    })

  })


})

server.post("/get-blog-comments", (req, res) => {
  let { blog_id, skip } = req.body;

  let maxLimit = 5;

  Comment.find({ blog_id, isReply: false })
    .populate("commented_by", "person_info.username personal_info.fullname personal_info.profile_img")
    .skip(skip)
    .limit(maxLimit)
    .sort({
    'commentdAt': -1
  })
    .then(comment => {
      return res.status(200).json(comment);
    })
    .catch(err => {
      console.log(err.message);
      return res.status(500).json({ error: err.message })
  })

})

server.post("/get-replies", (req, res) => {

  let { _id, skip } = req.body;

  let maxLimit = 5;

  Comment.findOne({ _id })
    .populate({
      path: "children",
      option: {
        limit: maxLimit,
        skip: skip,
        sort: { 'commentedAt': -1}
      },
      populate: {
        path: 'commented_by',
        select: "personal_info.profile_img personal_info.fullname personal_info.username"
      },
      select: "-blog_id -updatedAt"
    })
    .select("children")
    .then(doc => {
    return res.status(200).json({ replies: doc.children })
    })
    .catch(err => {
      console.log(err);
      return res.status(500).json({ error: err.message })
    })
  
})

const deleteComments = async (_id) => {
  try {
    const comment = await Comment.findOneAndDelete({ _id });
    if (!comment) return console.log("Comment not found");

    // Remove from parent's children if this comment has a parent
    if (comment.parent) {
      await Comment.findOneAndUpdate(
        { _id: comment.parent },
        { $pull: { children: _id } }
      );
      console.log("Comment removed from parent");
    }

    // Delete related notifications
    await Notification.findOneAndDelete({ comment: _id });
    console.log("Comment notification deleted");

    await Notification.findOneAndUpdate(
      { reply: _id },
      { $unset: { reply: 1 } }
    );
    console.log("Reply notification deleted");

    // Update the Blog comment counts
    await Blog.findOneAndUpdate(
      { _id: comment.blog_id },
      {
        $pull: { comments: _id },
        $inc: {
          "activity.total_comments": -1,
          "activity.total_parent_comments": comment.parent ? 0 : -1,
        },
      }
    );

    // Recursively delete children comments if they exist
    if (comment.children && comment.children.length) {
      for (const replyId of comment.children) {
        await deleteComments(replyId);
      }
    }
  } catch (err) {
    console.log("Error in deleteComments:", err.message);
  }
};

server.post("/delete-comment", verifyJWT, async (req, res) => {
  const user_id = req.user;
  const isAdmin = req.admin;
  const { _id } = req.body;

  try {
    const comment = await Comment.findOne({ _id });
    if (!comment) {
      return res.status(404).json({ error: "Comment not found" });
    }

    // Check if the user is allowed to delete the comment
    if (
      isAdmin ||
      user_id === comment.commented_by ||
      user_id === comment.blog_author
    ) {
      await deleteComments(_id);
      return res.status(200).json({ status: "done" });
    } else {
      return res
        .status(403)
        .json({ error: "You do not have permission to delete this comment" });
    }
  } catch (err) {
    console.error("Error in /delete-comment:", err.message);
    return res
      .status(500)
      .json({ error: "Server error while deleting comment" });
  }
});


server.get("/new-notification", verifyJWT, (req, res) => {
  
  let user_id = req.user; 
  
  Notification.exists({ notification_for: user_id, seen: false, user: { $ne: user_id } })
  .then(result => { 
    if (result) {
        return res.status(200).json({ new_notification_available: true })
      } else {
        return res.status(200).json({ new_notification_available: false })
      }
  })
    .catch(err => {
      console.log(err.message);
      return res.status(500).json({ error: err.message })
  })
  
})

server.post("/notifications", verifyJWT, (req, res) => {
  let user_id = req.user;

  let { page, filter, deletedDocCount } = req.body;

  let maxLimit = 10;

  let findQuery = {  notification_for: user_id, user: { $ne: user_id }}

  let skipDocs = ( page -1 ) * maxLimit;

  if(filter != 'all'){
    findQuery.type = filter;
  }

  if(deletedDocCount){
    skipDocs -= deletedDocCount;
  }

  Notification.find(findQuery)
  .skip(skipDocs)
  .limit(maxLimit)
  .populate("blog", "title blog_id")
  .populate("user", "personal_info.fullname personal_info.username personal_info.profile_img")
  .populate("comment", "comment")
  .populate("replied_on_comment", "comment")
  .populate("reply", "comment")
  .sort({ createdAt: -1 })
  .select(" createdAt type seen reply")
  .then(notifications => {

    Notification.updateMany(findQuery, { seen: true })
    .skip(skipDocs)
    .limit(maxLimit)
    .then(() => console.log( 'notification seen' ));

    return res.status(200).json({ notifications });
  })
  .catch(err => {
    res.status(500).json({error: err.message });
  })
})

server.post("/all-notifications-count", verifyJWT, (req, res) => {

  let user_id = req.user;

  let { filter } = req.body;

  let findQuery = { notification_for: user_id, user: { $ne: user_id }}

  if(filter != 'all'){
    findQuery.type = filter;
  }

  Notification.countDocuments(findQuery)
  .then(count => {
    return res.status(200).json({ totalDocs: count })
  })
  .catch(err => {
    return res.status(500).json({ error: err.message })
  })

})

server.post("/user-written-blogs", verifyJWT, (req, res ) => {

  let user_id = req.user;

  let { page, draft, query, deletedDocCount } = req.body;

  let maxLimit = 5;
  let skipDocs = (page - 1) * maxLimit;

  if(deletedDocCount){
    skipDocs -= deletedDocCount;
  }

  Blog.find({ author: user_id, draft, title: new RegExp( query, 'i') })
  .skip(skipDocs)
  .limit(maxLimit)
  .sort({ publishedAt: -1 })
  .select(" title banner publishedAt blog_id acitivity des draft -_id ")
  .then(blogs => {
    return res.status(200).json({ blogs })
  })
  .catch(err => {
    return res.status(500).json({ error: err.message });
  })

})

server.post("/user-written-blogs-count", verifyJWT, (req, res) => {

  let user_id = req.user;

  let { draft, query } = req.body;

  Blog.countDocuments({ author: user_id, draft, title: new RegExp(query, "i")  })
  .then(count => {
    return res.status(200).json({ totalDocs: count })
  })
  .catch(err => {
    console.log(err.message);
    return res.status(500).json({ error: err.message });
  }) 
})

 server.listen(PORT, () => {
    console.log('listening on port  ->' + PORT);
 })
