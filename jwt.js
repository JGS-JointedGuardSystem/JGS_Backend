require("dotenv").config();
const dbsettings = require('./var.js');
const mysql = require('mysql');
const express = require("express");
const jwt = require("jsonwebtoken");
const bodyParser = require("body-parser");
const fs = require('fs');
const cors = require('cors')
//const { request } = require("../session-practice/db");

require('console-stamp')(console, 'yyyy/mm/dd HH:MM:ss.l');

const options = {
    key: fs.readFileSync('./privkey.pem'),
    cert: fs.readFileSync('./cert.pem')
};

const app = express();


const http_port = 80
const https_port = 443

app.use(cors())
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const http = require('http').createServer(app)
const https = require('https').createServer(options, app);
const io = require('socket.io')(http, { cors: { origin: "*" } })
const frontend = io.of('/frontend');

const connection = mysql.createConnection({
    host: dbsettings.host,
    user: dbsettings.user,
    password: dbsettings.pw,
    database: dbsettings.db
});


// access token을 secret key 기반으로 생성
const generateAccessToken = (id) => {
    return jwt.sign({ id }, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "15m",
    });
};

// refersh token을 secret key  기반으로 생성
const generateRefreshToken = (id) => {
    return jwt.sign({ id }, process.env.REFRESH_TOKEN_SECRET, {
        expiresIn: "180 days",
    });
};

// 회원가입 DB에 저장
app.post("/sign", (req, res) => {
    let id = req.body.id;
    let pw = req.body.pw;
    let confirm_code = req.body.confirm_code;
    connection.query(`SELECT confirm_code FROM confirm WHERE confirm_code = ?;`, [confirm_code], function (error, confirm_results) {
        if (error) {
            console.log('SELECT confirm_code FROM confirm WHERE confirm_code = ? Error');
            console.log(error);
            return;
        }
        if (confirm_results.length == 0) {
            res.status(400).send('No matching code')
            return;
        }
        //DB에 중복되는 값 있는지 확인
        connection.query(`SELECT id FROM user WHERE id = ?;`, [id], function (error, results) {
            let type = new Array();
            if (error) {
                console.log('SELECT id FROM user WHERE id = ? Error');
                console.log(error);
                return;
            }
            //중복이면 return
            if (results.length > 0) {
                res.status(400).send('중복된 아이디입니다.')
                return;
            } else {//중복 아니면 DB에 ID,PW등록
                connection.query(`DELETE FROM confirm WHERE confirm_code = ?;`, [confirm_code], function (error, results) {
                    if (error) {
                        console.log('DELETE FROM confirm WHERE confirm_code = ?;');
                        console.log(error);
                        return;
                    }
                    console.log(results);
                });
                connection.query(`INSERT INTO user (id, pw) VALUES (?,?);`, [id, pw], (insert_error, insert_results) => {
                    if (insert_error) {
                        console.log('User Insert Error');
                        console.log(insert_error);
                        res.sendStatus(500);
                        return;
                    }
                    console.log(insert_results);
                    res.sendStatus(200);
                });
            }
        });

    });
});


// login 요청 및 성공시 access token, refresh token 발급
app.post("/login", (req, res) => {
    let id = req.body.id;
    let pw = req.body.pw;

    connection.query(`SELECT id FROM user WHERE id = ? AND pw = ?;`, [id, pw], function (error, results) {
        if (error) {
            console.log('no matching user blyat');
            console.log(error);
            return res.sendStatus(500);
        }
        console.log(results);
        if (results.length < 1) {
            res.status(500).send('비밀번호 오류입니다.')
        }
        else {
            let accessToken = generateAccessToken(results[0].id);
            let refreshToken = generateRefreshToken(results[0].id);
            res.json({ accessToken, refreshToken });
        }

    });
});

// access token의 유효성 검사
const authenticateAccessToken = (req, res, next) => {
    let authHeader = req.headers["authorization"];
    let token = authHeader && authHeader.split(" ")[1];

    if (!token) {
        console.log("wrong token format or token is not sended");
        return res.sendStatus(400);
    }

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (error, user) => {
        if (error) {
            console.log(error);
            return res.sendStatus(403);
        }

        req.user = user;
        next();
    });
};

// access token을 refresh token 기반으로 재발급
app.post("/refresh", (req, res) => {
    let refreshToken = req.body.refreshToken;
    if (!refreshToken) return res.sendStatus(401);

    jwt.verify(
        refreshToken,
        process.env.REFRESH_TOKEN_SECRET,
        (error, user) => {
            if (error) return res.sendStatus(403);

            const accessToken = generateAccessToken(user.id);

            res.json({ accessToken, refreshToken });
        }
    );
});

// access token 유효성 확인을 위한 예시 요청
app.get("/user", authenticateAccessToken, (req, res) => {
    console.log(req.user);
    res.sendStatus(200);
});

io.on('connection', socket => {
    console.log('Socket.IO Connected(Embedded):', socket.id)
    socket.on('Alert', Alert_data => {
        const { user_id, device_no } = Alert_data;
        connection.query(`SELECT socket_id FROM user_socketid WHERE user_id = ?;`, [user_id], function (error, results_id) {
            if (error) {
                console.log(error);
            }
            connection.query(`SELECT latitude,longitude,device_type FROM device_data WHERE user_id= ? AND device_no= ?;`, [user_id, device_no], function (error, results) {
                console.log(results);
                let dev_data = new Object();
                dev_data.id = device_no;
                dev_data.latitude = results[0].latitude;
                dev_data.longitude = results[0].longitude;
                dev_data.device_type = results[0].device_type;
                for (let i = 0; i < results_id.length; i++) {
                    console.log(results_id[i].socket_id);
                    frontend.to(results_id[i].socket_id).emit('Alert', dev_data);
                }
            });

        });
    })
    socket.on('test_func', test_data => {
        const { user_id, device_no } = test_data;

    })
})

frontend.on('connection', socket => {
    console.log('Socket.IO Connected(frontend):', socket.id)
    socket.on('Socket_login', login_data => {
        const { accesstoken, user_id } = login_data;
        jwt.verify(accesstoken, process.env.ACCESS_TOKEN_SECRET, (error, user) => {
            if (error) {
                console.log(error);
            }
            console.log(user_id);
            console.log(",");
            console.log(user);
            if (user.id == user_id) {
                connection.query(`INSERT INTO user_socketid (user_id, socket_id) VALUES (?,?);`, [user_id, socket.id], (insert_error, insert_results) => {
                    if (insert_error) {
                        console.log(insert_error);
                        return;
                    }
                    console.log(insert_results);
                });
            }
        });
    })
    socket.on('request_data_all', request_data => {
        const { user_id } = request_data;
        //Application과 Frontend에 현재 상태 DB 넘기기
        connection.query(`SELECT * FROM device_data WHERE user_id = ?;`, [user_id], function (error, results) {
            if (error) {
                console.log('SELECT * FROM device_data error');
                console.log(error);
                return;
            }
            console.log(results);
            frontend.emit('Send_Coord', results)
        });
    })
    socket.on('Add_Device', request_data => {
        const { user_id, device_no, latitude, longitude, device_type } = request_data;
        connection.query(`INSERT INTO device_data (user_id, device_no, latitude, longitude, device_type, curr_status) VALUES (?, ?, ?, ?, ?, ?);`, [user_id, device_no, latitude, longitude, device_type, "0"], (error, results) => {
            if (error) {
                console.log('INSERT INTO device_data error:');
                console.log(error);
                return;
            }
            console.log(results);
            console.log('device_data insert Success')
        });
    })
    socket.on('Remove_Device', request_data => {
        const { user_id, device_no } = request_data;
        connection.query(`DELETE FROM device_data WHERE user_id = ? AND device_no = ?;`, [user_id, device_no], (error, results) => {
            if (error) {
                console.log('DELETE FROM device_data error:');
                console.log(error);
                return;
            }
            console.log(results);
            console.log('device_data delete Success')
        });
    })

    socket.on('disconnect', function () {
        console.log("SOCKETIO disconnect EVENT: ", socket.id, " client disconnect");
        connection.query(`DELETE FROM user_socketid WHERE socket_id = ?;`, [socket.id], (error, results) => {
            if (error) {
                console.log(error);
                return;
            }
            console.log(results);
        });
    })
})

http.listen(http_port, () => {
    console.log(`Listening to port ${http_port}`);
});

https.listen(https_port, () => {
    console.log(`Listening to port ${https_port}`)
})