let mcan, mctx, mcw, mch, mcm;
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    // Browser environment
    mcan = document.getElementById("maincanvas");
    mctx = mcan.getContext("2d");
    mcan.width = window.innerWidth;
    mcan.height = window.innerHeight;
    mcw = mcan.width;
    mch = mcan.height;
    mcm = mcw > mch ? mch : mcw;
} else {
    // Simulation environment (Node.js)
    const { CanvasShim, requestAnimationFrameShim, keysDown } = require('./Sim/simulate');
    mcan = new CanvasShim(800, 600);
    mctx = mcan.getContext('2d');
    mcw = mcan.width;
    mch = mcan.height;
    mcm = mcw > mch ? mch : mcw;
    global.requestAnimationFrame = requestAnimationFrameShim;
}
let timer = 0;
let yrCanShoot = true;
if (typeof keysDown === 'undefined') {
    keysDown = [];
}
let ledgeCount = 18;
let bc = [102/255, 77/255, 51/255];
yrm = mcm/20;
let velChange = mch/324;

class Ledge{
    constructor(){
        this.id = 0;
        this.y = randomBetween(0.1, 0.9, 0.01);
        this.x = randomBetween(0.1, 0.9, 0.01);
        this.w = randomBetween(1/16, 1/4, 0.01);
    }
    drawSelf(ctx, cw, ch){
        let a = (this.id/(ledgeCount-1))/2+0.25;
        ctx.fillStyle = colorMix(...bc, 1-a, 0, 0, 0, a);
        ctx.fillRect((this.x-this.w/2)*cw, this.y*ch, this.w*cw, ch);
    }
}

class YourRobot{
    constructor(){
        this.health = 1;
        this.x = ledgeOrder[Math.ceil(ledgeCount/2)].x*mcw;
        this.y = ledgeOrder[Math.ceil(ledgeCount/2)].y*mch-yrm/2;
        this.velX = 0;
        this.velY = 0;
        this.lasers = [];
        this.idCounter = 0;
        this.atBottom = false;
    }
    drawSelf(){
        mctx.fillStyle = colorString(0.5, 0.5, 0.5, 1);
        mctx.fillRect(this.x-yrm/2, this.y-yrm/2, yrm, yrm);
        mctx.strokeStyle = colorString(0, 0, this.health, 1);
        mctx.lineWidth = yrm/8;
        mctx.strokeRect(this.x-yrm/4, this.y-yrm/4, yrm/2, yrm/2);
    }
}

class Robot{
    constructor(id){
        this.health = 1;
        this.id = id;
        this.x = Math.random()*mcw;
        this.y = mch;
        this.speed = velChange*3;
        this.lasers = [];
        this.idCounter = 0;
        this.tarD = randomBetween(mcm/8, mcm/2, 1);
        this.shootTimes = [];
        for (let i=0; i<randomBetween(1, 3, 1); i++) {
            let info = {d: 0, v: 0};
            info.d = randomBetween(120, 360, 1);
            info.v = randomBetween(0, info.d, 1);
            this.shootTimes.push(info);
        }
        this.laserSpeed = randomBetween(2, 11, 1);
    }
    shoot(){
        let laser = new Laser(this.idCounter, this, false, yourRobot.x, yourRobot.y);
        this.lasers.push(laser);
        this.idCounter ++;
    }
    drawSelf(){
        mctx.fillStyle = colorString(0.5, 0.5, 0.5, 1);
        mctx.fillRect(this.x-yrm/2, this.y-yrm/2, yrm, yrm);
        mctx.strokeStyle = colorString(this.health, this.health, 0, 1);
        mctx.lineWidth = yrm/8;
        mctx.strokeRect(this.x-yrm/4, this.y-yrm/4, yrm/2, yrm/2);
    }
    remove(){
        for (let i=0; i<robots.length; i++) {
            if (robots[i].id == this.id) {
                robots.splice(i, 1);
            }
        }
    }
    updatePhysics(){
        let angle = Math.atan2(this.y-yourRobot.y, this.x-yourRobot.x);
        let distance = getDiagonal(this.x-yourRobot.x, this.y-yourRobot.y);
        let newA = angle+this.speed/distance;
        let newD = distance+(this.tarD-distance)/(100/velChange);
        this.x = yourRobot.x+Math.cos(newA)*newD;
        this.y = yourRobot.y+Math.sin(newA)*newD;

        this.shootTimes.forEach((st)=>{
            if (timer%st.d == st.v) {
                this.shoot();
            }
        });

        this.lasers.forEach((laser)=>{
            laser.x += Math.cos(laser.angle)*this.speed;
            laser.y += Math.sin(laser.angle)*this.speed;
            if (laser.x > mcw) {
                laser.remove();
            }
            if (laser.y > mch) {
                laser.remove();
            }
            if (laser.x < 0) {
                laser.remove();
            }
            if (laser.y < 0) {
                laser.remove();
            }
        });
    }
}

class Laser{
    constructor(id, robot, yours, tarX, tarY){
        this.id = id;
        this.yours = yours;
        this.robot = robot;
        this.tarX = tarX;
        this.tarY = tarY;
        this.x = robot.x;
        this.y = robot.y;
        this.angle = Math.atan2(tarY-this.y, tarX-this.x);
    }
    drawSelf(){
        if (this.yours) {
            mctx.strokeStyle = "#0000ff";
        } else {
            mctx.strokeStyle = "#ffff00";
        }
        mctx.lineWidth = 5;
        mctx.beginPath();
        mctx.moveTo(this.x-Math.cos(this.angle)*10, this.y-Math.sin(this.angle)*10);
        mctx.lineTo(this.x+Math.cos(this.angle)*10, this.y+Math.sin(this.angle)*10);
        mctx.stroke();
    }
    remove(){
        for (let i=0; i<this.robot.lasers.length; i++) {
            if (this.robot.lasers[i].id == this.id) {
                this.robot.lasers.splice(i, 1);
            }
        }
    }
}

function randomBetween(min, max, precision){
    return Math.floor((Math.random()*(max-min)+min)/precision)*precision;
}

function colorString(r, g, b, a){
    r = Math.floor(r*255)*256*256*256;
    g = Math.floor(g*255)*256*256;
    b = Math.floor(b*255)*256;
    a = Math.floor(a*255);
    return "#"+(r+g+b+a).toString(16).padStart(8, "0");
}

function getDiagonal(a, b){
    return(Math.sqrt(a**2+b**2));
}

function colorMix(r1, g1, b1, a1, r2, g2, b2, a2){
    let r = r1*a1+r2*a2;
    let g = g1*a1+g2*a2;
    let b = b1*a1+b2*a2;
    let a = a1+a2;
    return colorString(r, g, b, a);
}

let ledges = [];
for (let i=0; i<ledgeCount; i++) {
    let ledge = new Ledge();
    ledges.push(ledge);
}
let ledgeOrder = [];
while (ledges.length > 0) {
    let highest = {item: 0, y: 1};
    for (let i=0; i<ledges.length; i++) {
        if (ledges[i].y < highest.y) {
            highest.item = i;
            highest.y = ledges[i].y;
        }
    }
    ledges[highest.item].id = ledgeOrder.length;
    ledgeOrder.push(ledges[highest.item]);
    ledges.splice(highest.item, 1);
}

let yourRobot = new YourRobot();
let robots = [];
for (let i=0; i<12; i++) {
    let robot = new Robot(robots.length);
    robots.push(robot);
}
let defaultRobot = new Robot(-1);
defaultRobot.x = mcm*-2;
defaultRobot.y = mcm*-2;

function drawingLoop(){
    mctx.fillStyle = colorString(...bc, 1);
    mctx.fillRect(0, 0, mcw, mch);
    ledgeOrder.forEach((ledge)=>{
        ledge.drawSelf(mctx, mcw, mch);
    });
    robots.forEach((robot)=>{
        robot.lasers.forEach((laser)=>{
            laser.drawSelf();
        });
    });
    yourRobot.lasers.forEach((laser)=>{
        laser.drawSelf();
    });
    robots.forEach((robot)=>{
        robot.drawSelf();
    });
    yourRobot.drawSelf();
    mctx.fillStyle = colorString(0.7, 0, 0, 0.7);
    mctx.fillRect(0, mch*0.95, mcw, mch*0.05);
    if (yourRobot.health > 0) {
        requestAnimationFrame(drawingLoop);
    } else {
        yourRobot.health = 0;
        yourRobot.drawSelf();
    }
}

let falling = true;
function physicsLoop(){
    yourRobot.x += yourRobot.velX;
    yourRobot.y += yourRobot.velY;
    falling = true;
    ledgeOrder.forEach((ledge)=>{
        if (yourRobot.y+yrm/2 > ledge.y*mch-yourRobot.velY-1) {
            if (yourRobot.y+yrm/2 < ledge.y*mch+yourRobot.velY+1) {
                if (yourRobot.x > (ledge.x-ledge.w/2)*mcw-yrm/2) {
                    if (yourRobot.x < (ledge.x+ledge.w/2)*mcw+yrm/2) {
                        falling = false;
                        yourRobot.atBottom = false;
                    }
                }
            }
        }
    });
    if (yourRobot.y+yrm/2 > mch-yourRobot.velY-1) {
        if (yourRobot.y+yrm/2 < mch+yourRobot.velY+1) {
            falling = false;
            yourRobot.atBottom = true;
        }
    }
    if (falling) {
        yourRobot.velY += velChange/4;
    } else {
        yourRobot.velY = 0;
        yourRobot.velX *= 0.95;
    }
    yourRobot.lasers.forEach((laser)=>{
        laser.x += Math.cos(laser.angle)*10;
        laser.y += Math.sin(laser.angle)*10;
        if (laser.x > mcw) {
            laser.remove();
        }
        if (laser.y > mch) {
            laser.remove();
        }
        if (laser.x < 0) {
            laser.remove();
        }
        if (laser.y < 0) {
            laser.remove();
        }
    });
    robots.forEach((robot)=>{
        robot.updatePhysics();
    });
    timer ++;
    if (timer%10 == 0) {
        yrCanShoot = true;
    }
    if (robots.length > 0) {
        yourRobot.lasers.forEach((laser)=>{
            let nearestRobot = defaultRobot;
            robots.forEach((robot)=>{
                if (robot.x**2+robot.y**2 < nearestRobot.x**2+nearestRobot.y**2) {
                    nearestRobot = robot;
                }
            });
            if (laser.x > nearestRobot.x-yrm) {
                if (laser.x < nearestRobot.x+yrm) {
                    if (laser.y > nearestRobot.y-yrm) {
                        if (laser.y < nearestRobot.y+yrm) {
                            laser.remove();
                            nearestRobot.health -= 0.2;
                        }
                    }
                }
            }
        });
    }
    robots.forEach((robot)=>{
        robot.lasers.forEach((laser)=>{
            if (laser.x > yourRobot.x-yrm/2) {
                if (laser.x < yourRobot.x+yrm/2) {
                    if (laser.y > yourRobot.y-yrm/2) {
                        if (laser.y < yourRobot.y+yrm/2) {
                            laser.remove();
                            yourRobot.health -= 0.05;
                            robot.health += 0.2;
                            if (robot.health > 1) {
                                robot.health = 1;
                            }
                        }
                    }
                }
            }
        });
        robot.health -= 1/1200;
        if (robot.health < 0) {
            robot.remove();
        }
    });
    if (yourRobot.y > mch-yrm*1.5) {
        yourRobot.health -= 1/180;
    }
    if (yourRobot.health < 1-1/3600) {
        yourRobot.health += 1/3600;
    }
    keysDown.forEach((keyDown)=>{
        if (keyDown.toLowerCase() == "a") {
            yourRobot.velX = velChange*-3;
        }
        if (keyDown.toLowerCase() == "d") {
            yourRobot.velX = velChange*3;
        }
        if (keyDown.toLowerCase() == "w") {
            if (!falling) {
                yourRobot.velY = velChange*-6;
            }
        }
        if (keyDown.toLowerCase() == "s") {
            if (!falling) {
                if (!yourRobot.atBottom) {
                    yourRobot.velY = velChange*3;
                }
            }
        }
        if (keyDown.toLowerCase() == "f") {
            yourRobot.velX = 0;
        }
    });
    if (yourRobot.health > 0) {
        requestAnimationFrame(physicsLoop);
    }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    physicsLoop();
    drawingLoop();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    function keyDownEvent(event){
        let hasKey = false;
        keysDown.forEach((keyDown)=>{
            if (keyDown == event.key) {
                hasKey = true;
            }
        });
        if (!hasKey) {
            keysDown.push(event.key);
        }
    }
    document.addEventListener("keydown", keyDownEvent);

    function keyUpEvent(event){
        for (let i=0; i<keysDown.length; i++) {
            if (keysDown[i] == event.key) {
                keysDown.splice(i, 1);
            }
        }
    }
    document.addEventListener("keyup", keyUpEvent);

    function mcanMousemove(event){
        if (yrCanShoot) {
            let laser = new Laser(yourRobot.idCounter, yourRobot, true, event.x, event.y);
            yourRobot.lasers.push(laser);
            yourRobot.idCounter ++;
            yrCanShoot = false;
        }
    }
    mcan.addEventListener("mousemove", mcanMousemove);
}

// Export for simulation
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        Ledge,
        YourRobot,
        Robot,
        Laser,
        randomBetween,
        colorString,
        getDiagonal,
        colorMix,
        physicsLoop,
        drawingLoop,
        ledgeOrder,
        yourRobot,
        robots,
        defaultRobot,
        keysDown,
        timer,
        yrCanShoot,
        velChange,
        yrm,
        mcw,
        mch,
        mcm,
        mcan,
        mctx
    };
}