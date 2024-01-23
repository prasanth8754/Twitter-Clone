const express = require('express')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const path = require('path')
const app = express()
const dbPath = path.join(__dirname, 'twitterClone.db')
app.use(express.json())

// initialize and Connecting Database...
let db = null
const initializeAndConnectDB = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () =>
      console.log('Server Running at http://localhost:3000/'),
    )
  } catch (err) {
    console.log(`DB ERROR: ${err.message}`)
    process.exit(1)
  }
}
initializeAndConnectDB()

//section 1 (API 1) resgister user...

app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body

  const hashedPassword = await bcrypt.hash(password, 10)

  const getUserQuery = `
  SELECT 
  * 
  FROM 
  user 
  WHERE username = "${username}";`

  const dbUser = await db.get(getUserQuery)

  if (dbUser !== undefined) {
    response.status(400)
    response.send('User already exists')
  } else {
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      const createUserQuery = `
        INSERT INTO 
        user(username,password,name,gender)
        values (
          "${username}",
          "${hashedPassword}",
          "${name}",
          "${gender}"
        );`

      await db.run(createUserQuery)
      response.send('User created successfully')
    }
  }
})

//section 2 (API 2) Login user API...

app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const payload = {username}

  const getUserQuery = `
  SELECT 
  * 
  FROM 
  user 
  WHERE username = "${username}";`

  const dbUser = await db.get(getUserQuery)

  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched) {
      const jwtToken = jwt.sign(payload, 'itsPrasanthPassword')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

//section authtoken ### Authentication with JWT Token...

const authenticateToken = (request, response, next) => {
  const authToken = request.headers['authorization']
  let jwtToken
  if (authToken !== undefined) {
    jwtToken = authToken.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'itsPrasanthPassword', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        const getUserId = `
        SELECT user_id as userId
        FROM user
        WHERE username = "${payload.username}";`

        const dbUser = await db.get(getUserId)
        request.userId = dbUser.userId
        next()
      }
    })
  }
}

// section 3 (API 3) Returns the latest tweets of people whom the user follows. Return 4 tweets at a time.

app.get('/user/tweets/feed/', authenticateToken, async (request, response) => {
  const userId = request.userId

  const getLatestTweetsQuery = `
  SELECT 
  username,tweet,date_time as dateTime
  FROM (user
  INNER JOIN follower
  ON user.user_id = follower.following_user_id) as temp
  INNER JOIN tweet 
  ON temp.user_id = tweet.user_id
  WHERE temp.follower_user_id = ${userId}
  ORDER BY date_time DESC
  LIMIT 4;`

  const latestTweets = await db.all(getLatestTweetsQuery)
  response.send(latestTweets)
})

//section 4 (API 4) Returns the list of all names of people whom the user follows

app.get('/user/following/', authenticateToken, async (request, response) => {
  const userId = request.userId

  const getFollowingUserNamesQuery = `
  SELECT name
  FROM (user 
  INNER JOIN follower
  ON user.user_id = follower.following_user_id) as temp
  WHERE temp.follower_user_id = ${userId};`

  const nameList = await db.all(getFollowingUserNamesQuery)
  response.send(nameList)
})

//section 5 (API 5) Returns the list of all names of people who follows the user

app.get('/user/followers/', authenticateToken, async (request, response) => {
  const userId = request.userId

  const getFollowerUserNamesQuery = `
  SELECT name
  FROM (user 
  INNER JOIN follower
  ON user.user_id = follower.follower_user_id) as temp
  WHERE temp.following_user_id = ${userId};`

  const nameList = await db.all(getFollowerUserNamesQuery)
  response.send(nameList)
})

// provide acess only if following...(middleware function)

const isPeopleInFollowingList = async (request, response, next) => {
  const {tweetId} = request.params
  const userId = request.userId

  const getFollowingUserId = `
  SELECT user_id as userId
  FROM tweet
  WHERE tweet_id = "${tweetId}";`

  const dbTweetUser = await db.get(getFollowingUserId)

  const getFollowingUserNameQuery = `
  SELECT name
  FROM (user 
  INNER JOIN follower
  ON user.user_id = follower.following_user_id) as temp
  WHERE temp.follower_user_id = ${userId} 
  AND 
  temp.following_user_id = ${dbTweetUser.userId};`

  const name = await db.get(getFollowingUserNameQuery)

  if (name === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    next()
  }
}

//section 6 (API 6)

app.get(
  '/tweets/:tweetId/',
  authenticateToken,
  isPeopleInFollowingList,
  async (request, response) => {
    const {tweetId} = request.params
    const getTweetQuery = `
    SELECT tweet,
     COUNT(DISTINCT like_id) as likes,
     COUNT(DISTINCT reply) as replies,
     date_time as dateTime
     FROM tweet LEFT JOIN
     like ON tweet.tweet_id = like.tweet_id
     LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
     WHERE tweet.tweet_id = ${tweetId}
     GROUP BY tweet.tweet_id;`

    const tweet = await db.get(getTweetQuery)
    response.send(tweet)
  },
)

//section 7 (API 7)

app.get(
  '/tweets/:tweetId/likes/',
  authenticateToken,
  isPeopleInFollowingList,
  async (request, response) => {
    const {tweetId} = request.params

    const getLikedPeopleQuery = `
      SELECT username
      FROM (user INNER JOIN like
      ON user.user_id = like.user_id) as temp
      WHERE temp.tweet_id = ${tweetId};`

    const likedPeople = await db.all(getLikedPeopleQuery)
    const likes = likedPeople.map(item => item['username'])
    response.send({likes})
  },
)

// section 8 (API 8)

app.get(
  '/tweets/:tweetId/replies/',
  authenticateToken,
  isPeopleInFollowingList,
  async (request, response) => {
    const {tweetId} = request.params

    const getRepliesOfPeopleQuery = `
      SELECT name, reply 
      FROM (user INNER JOIN reply
      ON user.user_id = reply.user_id) as temp
      WHERE temp.tweet_id = ${tweetId};`

    const repliesOfPeople = await db.all(getRepliesOfPeopleQuery)
    const replies = repliesOfPeople.map(item => item)
    response.send({replies})
  },
)

//section 9 (API 9) Returns a list of all tweets of the user

app.get('/user/tweets/', authenticateToken, async (request, response) => {
  const userId = request.userId

  const getTweetQuery = `
     SELECT tweet,
     COUNT(DISTINCT like_id) as likes,
     COUNT(DISTINCT reply) as replies,
     date_time as dateTime
     FROM tweet LEFT JOIN
     like ON tweet.tweet_id = like.tweet_id
     LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
     WHERE tweet.user_id = ${userId}
     GROUP BY tweet.tweet_id;`

  const tweet = await db.all(getTweetQuery)
  response.send(tweet)
})

// section 10 (API 10) Create a tweet in the tweet table

app.post('/user/tweets/', authenticateToken, async (request, response) => {
  const userId = request.userId
  const {tweet} = request.body

  const addTweetQuery = `
  INSERT INTO
  tweet (tweet,user_id)
  values("${tweet}",${userId});`

  await db.run(addTweetQuery)
  response.send('Created a Tweet')
})

// section 11 (API 11)

app.delete(
  '/tweets/:tweetId/',
  authenticateToken,
  async (request, response) => {
    const userId = request.userId
    const {tweetId} = request.params

    const getTweetUserId = `
    SELECT user_id as userId
    FROM tweet
    WHERE tweet_id = ${tweetId};`

    const tweetUserId = await db.get(getTweetUserId)

    if (userId !== tweetUserId.userId) {
      response.status(401)
      response.send('Invalid Request')
    } else {
      const deleteTweetQuery = `
      DELETE FROM
      tweet 
      WHERE tweet_id = ${tweetId};`

      await db.run(deleteTweetQuery)
      response.send('Tweet Removed')
    }
  },
)

module.exports = app
