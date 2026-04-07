const canvas = document.getElementById("raceCanvas");
const ctx = canvas.getContext("2d");

const startBtn = document.getElementById("startBtn");
const boostMeBtn = document.getElementById("boostMeBtn");
const boostOthersBtn = document.getElementById("boostOthersBtn");
const resetBtn = document.getElementById("resetBtn");

const raceState = document.getElementById("raceState");
const distanceLeft = document.getElementById("distanceLeft");
const leaderName = document.getElementById("leaderName");
const currentSpeed = document.getElementById("currentSpeed");
const myProgress = document.getElementById("myProgress");
const racerStats = document.getElementById("racerStats");
const announcement = document.getElementById("announcement");

const DISTANCE_METERS = 100;
const BOOST_AMOUNT = 0.2;
const MAX_PROGRESS_STEP = 0.0055;
const MIN_PROGRESS_STEP = 0.0012;
const TRACK_WIDTH = 108;
const LANE_OFFSETS = [-30, -10, 10, 30];

const TRACK_POINTS = [
    { x: 154, y: 388 },
    { x: 184, y: 218 },
    { x: 316, y: 126 },
    { x: 486, y: 132 },
    { x: 610, y: 238 },
    { x: 624, y: 420 },
    { x: 528, y: 578 },
    { x: 340, y: 626 },
    { x: 184, y: 540 },
    { x: 136, y: 404 }
];

let racers = [];
let racing = false;
let winner = null;
let animationId = null;
let lastFrameTime = 0;
let pathSamples = [];
let trackLength = 0;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function lerp(start, end, ratio) {
    return start + (end - start) * ratio;
}

function cubicBezier(p0, p1, p2, p3, t) {
    const mt = 1 - t;
    return (
        mt * mt * mt * p0 +
        3 * mt * mt * t * p1 +
        3 * mt * t * t * p2 +
        t * t * t * p3
    );
}

function cubicDerivative(p0, p1, p2, p3, t) {
    const mt = 1 - t;
    return (
        3 * mt * mt * (p1 - p0) +
        6 * mt * t * (p2 - p1) +
        3 * t * t * (p3 - p2)
    );
}

function buildPathSamples() {
    pathSamples = [];
    trackLength = 0;

    const samples = [];
    for (let i = 0; i < TRACK_POINTS.length - 1; i += 1) {
        const prev = TRACK_POINTS[Math.max(0, i - 1)];
        const current = TRACK_POINTS[i];
        const next = TRACK_POINTS[i + 1];
        const next2 = TRACK_POINTS[Math.min(TRACK_POINTS.length - 1, i + 2)];

        const cp1 = {
            x: current.x + (next.x - prev.x) / 6,
            y: current.y + (next.y - prev.y) / 6
        };
        const cp2 = {
            x: next.x - (next2.x - current.x) / 6,
            y: next.y - (next2.y - current.y) / 6
        };

        const resolution = 38;
        for (let step = 0; step <= resolution; step += 1) {
            if (i > 0 && step === 0) {
                continue;
            }

            const t = step / resolution;
            const x = cubicBezier(current.x, cp1.x, cp2.x, next.x, t);
            const y = cubicBezier(current.y, cp1.y, cp2.y, next.y, t);
            const dx = cubicDerivative(current.x, cp1.x, cp2.x, next.x, t);
            const dy = cubicDerivative(current.y, cp1.y, cp2.y, next.y, t);

            const previous = samples[samples.length - 1];
            if (previous) {
                trackLength += Math.hypot(x - previous.x, y - previous.y);
            }

            samples.push({
                x,
                y,
                angle: Math.atan2(dy, dx),
                distance: trackLength
            });
        }
    }

    pathSamples = samples;
}

function createRacer(id, name, color, lane, speed, role) {
    return {
        id,
        name,
        color,
        lane,
        speed,
        role,
        progress: 0,
        wobbleSeed: Math.random() * Math.PI * 2
    };
}

function createInitialRacers() {
    return [
        createRacer("me", "나", "#7af7c4", 0, 1.04, "Player"),
        createRacer("npc1", "레이서 1", "#ff6f91", 1, 0.98, "CPU"),
        createRacer("npc2", "레이서 2", "#ffd166", 2, 1.01, "CPU"),
        createRacer("npc3", "레이서 3", "#75a9ff", 3, 0.96, "CPU")
    ];
}

function getLeader() {
    return racers.reduce((currentLeader, racer) => {
        if (!currentLeader || racer.progress > currentLeader.progress) {
            return racer;
        }
        return currentLeader;
    }, null);
}

function getSampleAtProgress(progress) {
    const targetDistance = clamp(progress, 0, 1) * trackLength;

    for (let i = 1; i < pathSamples.length; i += 1) {
        const prev = pathSamples[i - 1];
        const next = pathSamples[i];
        if (targetDistance <= next.distance) {
            const span = next.distance - prev.distance || 1;
            const ratio = (targetDistance - prev.distance) / span;
            return {
                x: lerp(prev.x, next.x, ratio),
                y: lerp(prev.y, next.y, ratio),
                angle: lerp(prev.angle, next.angle, ratio)
            };
        }
    }

    return pathSamples[pathSamples.length - 1];
}

function getRacerPosition(racer, elapsed) {
    const sample = getSampleAtProgress(racer.progress);
    const normalX = -Math.sin(sample.angle);
    const normalY = Math.cos(sample.angle);
    const sway = Math.sin(elapsed * 0.004 + racer.wobbleSeed) * 2.5;
    const offset = LANE_OFFSETS[racer.lane] + sway;

    return {
        x: sample.x + normalX * offset,
        y: sample.y + normalY * offset,
        angle: sample.angle
    };
}

function drawBackground() {
    const ground = ctx.createRadialGradient(
        canvas.width / 2,
        canvas.height / 2,
        40,
        canvas.width / 2,
        canvas.height / 2,
        canvas.width / 2
    );
    ground.addColorStop(0, "#12263c");
    ground.addColorStop(0.55, "#0c1a2a");
    ground.addColorStop(1, "#050b12");
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "rgba(30, 82, 52, 0.45)";
    ctx.beginPath();
    ctx.arc(208, 208, 112, 0, Math.PI * 2);
    ctx.arc(566, 564, 126, 0, Math.PI * 2);
    ctx.arc(560, 192, 84, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.05)";
    for (let i = 0; i < 22; i += 1) {
        ctx.beginPath();
        ctx.arc(80 + (i % 6) * 110, 56 + Math.floor(i / 6) * 42, 2, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, 332, 0, Math.PI * 2);
    ctx.stroke();
}

function drawTrackBase() {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.strokeStyle = "rgba(0,0,0,0.32)";
    ctx.lineWidth = TRACK_WIDTH + 18;
    ctx.beginPath();
    ctx.moveTo(pathSamples[0].x, pathSamples[0].y);
    pathSamples.forEach((sample) => ctx.lineTo(sample.x, sample.y));
    ctx.stroke();

    const asphalt = ctx.createLinearGradient(0, 120, canvas.width, canvas.height);
    asphalt.addColorStop(0, "#5d6773");
    asphalt.addColorStop(1, "#303843");
    ctx.strokeStyle = asphalt;
    ctx.lineWidth = TRACK_WIDTH;
    ctx.beginPath();
    ctx.moveTo(pathSamples[0].x, pathSamples[0].y);
    pathSamples.forEach((sample) => ctx.lineTo(sample.x, sample.y));
    ctx.stroke();
}

function drawLaneLines() {
    const boundaryOffsets = [-24, 0, 24];

    boundaryOffsets.forEach((offset) => {
        ctx.beginPath();
        pathSamples.forEach((sample, index) => {
            const normalX = -Math.sin(sample.angle);
            const normalY = Math.cos(sample.angle);
            const x = sample.x + normalX * offset;
            const y = sample.y + normalY * offset;

            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });

        ctx.strokeStyle = "rgba(255,255,255,0.22)";
        ctx.lineWidth = 2;
        ctx.setLineDash([14, 12]);
        ctx.stroke();
    });

    ctx.setLineDash([]);
}

function drawTrackEdge() {
    const edgeOffsets = [-TRACK_WIDTH / 2, TRACK_WIDTH / 2];

    edgeOffsets.forEach((offset) => {
        ctx.beginPath();
        pathSamples.forEach((sample, index) => {
            const normalX = -Math.sin(sample.angle);
            const normalY = Math.cos(sample.angle);
            const x = sample.x + normalX * offset;
            const y = sample.y + normalY * offset;

            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });

        ctx.strokeStyle = "rgba(248,250,252,0.75)";
        ctx.lineWidth = 4;
        ctx.stroke();
    });
}

function drawFinishLine() {
    const finish = getSampleAtProgress(1);
    const normalX = -Math.sin(finish.angle);
    const normalY = Math.cos(finish.angle);
    const tangentX = Math.cos(finish.angle);
    const tangentY = Math.sin(finish.angle);
    const stripeHalf = TRACK_WIDTH / 2;

    for (let i = -4; i < 4; i += 1) {
        const startX = finish.x + normalX * (i * 12) - tangentX * 18;
        const startY = finish.y + normalY * (i * 12) - tangentY * 18;
        ctx.fillStyle = i % 2 === 0 ? "#f8fafc" : "#111827";
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(startX + tangentX * 36, startY + tangentY * 36);
        ctx.lineTo(startX + tangentX * 36 + normalX * 12, startY + tangentY * 36 + normalY * 12);
        ctx.lineTo(startX + normalX * 12, startY + normalY * 12);
        ctx.closePath();
        ctx.fill();
    }

    ctx.strokeStyle = "rgba(255,255,255,0.65)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(finish.x - normalX * stripeHalf, finish.y - normalY * stripeHalf);
    ctx.lineTo(finish.x + normalX * stripeHalf, finish.y + normalY * stripeHalf);
    ctx.stroke();
}

function drawHud() {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "700 26px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText("CIRCULAR COURSE", canvas.width / 2, 58);

    ctx.font = "600 14px Segoe UI";
    ctx.fillStyle = "rgba(226,232,240,0.82)";
    ctx.fillText("Track Orb", canvas.width / 2, 84);
    ctx.textAlign = "start";
}

function drawRacers(elapsed) {
    const ordered = [...racers].sort((a, b) => a.progress - b.progress);

    ordered.forEach((racer) => {
        const { x, y } = getRacerPosition(racer, elapsed);
        const radius = racer.id === "me" ? 10 : 8;

        const glow = ctx.createRadialGradient(x, y, 3, x, y, 22);
        glow.addColorStop(0, `${racer.color}ff`);
        glow.addColorStop(1, `${racer.color}00`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, 22, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = racer.color;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = racer.id === "me" ? "#ffffff" : "rgba(255,255,255,0.65)";
        ctx.lineWidth = racer.id === "me" ? 3 : 2;
        ctx.beginPath();
        ctx.arc(x, y, radius + 2, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.font = "600 13px Segoe UI";
        ctx.textAlign = "center";
        ctx.fillText(racer.name, x, y - 16);
    });

    ctx.textAlign = "start";
}

function renderScene(elapsed) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackground();
    drawTrackBase();
    drawLaneLines();
    drawTrackEdge();
    drawFinishLine();
    drawHud();
    drawRacers(elapsed);
}

function updateRace(delta) {
    if (!racing) {
        return;
    }

    racers.forEach((racer) => {
        const randomFactor = 0.88 + Math.random() * 0.32;
        const deltaBoost = delta / 16.6667;
        const step = clamp(racer.speed * 0.0019 * randomFactor * deltaBoost, MIN_PROGRESS_STEP, MAX_PROGRESS_STEP);
        racer.progress = clamp(racer.progress + step, 0, 1);
    });

    const finisher = racers.find((racer) => racer.progress >= 1);
    if (finisher) {
        winner = finisher;
        racing = false;
        announcement.textContent = `${finisher.name}가 곡선 코스를 가장 먼저 통과했습니다.`;
    }
}

function updateUi() {
    const leader = getLeader();
    const me = racers.find((racer) => racer.id === "me");
    const remaining = leader
        ? Math.max(0, DISTANCE_METERS - Math.round(leader.progress * DISTANCE_METERS))
        : DISTANCE_METERS;
    const myDistance = me ? Math.round(me.progress * DISTANCE_METERS) : 0;

    raceState.textContent = winner ? `${winner.name} 승리` : racing ? "진행 중" : "대기 중";
    distanceLeft.textContent = `${remaining}m`;
    leaderName.textContent = leader ? leader.name : "-";
    currentSpeed.textContent = me ? `${me.speed.toFixed(2)}x` : "-";
    myProgress.textContent = `${myDistance}m`;

    racerStats.innerHTML = racers
        .slice()
        .sort((a, b) => b.progress - a.progress)
        .map((racer) => {
            const speedLabel = racer.speed.toFixed(2);
            const progressLabel = Math.round(racer.progress * DISTANCE_METERS);
            return `
                <div class="racer-stat" style="--racer-color:${racer.color}">
                    <span class="racer-role">${racer.role}</span>
                    <div class="racer-name"><span class="racer-dot"></span>${racer.name}</div>
                    <div class="racer-speed">현재 속도 ${speedLabel}x · 진행 ${progressLabel}m</div>
                </div>
            `;
        })
        .join("");
}

function frame(timestamp) {
    if (!lastFrameTime) {
        lastFrameTime = timestamp;
    }

    const delta = timestamp - lastFrameTime;
    lastFrameTime = timestamp;

    updateRace(delta);
    renderScene(timestamp);
    updateUi();

    if (racing) {
        animationId = requestAnimationFrame(frame);
    } else {
        animationId = null;
    }
}

function startRace() {
    if (racing || winner) {
        return;
    }

    racing = true;
    announcement.textContent = "직선과 곡선이 섞인 코스에서 레이스가 시작됐습니다.";
    lastFrameTime = 0;
    animationId = requestAnimationFrame(frame);
}

function boostMe() {
    const me = racers.find((racer) => racer.id === "me");
    me.speed = clamp(me.speed + BOOST_AMOUNT, 0.6, 2.4);
    announcement.textContent = `내 레이서의 속도가 ${me.speed.toFixed(2)}배로 올라갔습니다.`;
    updateUi();
    renderScene(performance.now());
}

function boostOthers() {
    racers
        .filter((racer) => racer.id !== "me")
        .forEach((racer) => {
            racer.speed = clamp(racer.speed + BOOST_AMOUNT, 0.6, 2.4);
        });

    announcement.textContent = "다른 레이서들의 속도를 올려서 코스 흐름이 더 거칠어졌습니다.";
    updateUi();
    renderScene(performance.now());
}

function resetRace() {
    racing = false;
    winner = null;
    lastFrameTime = 0;

    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }

    racers = createInitialRacers();
    announcement.textContent = "출발 버튼을 누르면 평면 코스 레이스가 시작됩니다.";
    renderScene(performance.now());
    updateUi();
}

buildPathSamples();

startBtn.addEventListener("click", startRace);
boostMeBtn.addEventListener("click", boostMe);
boostOthersBtn.addEventListener("click", boostOthers);
resetBtn.addEventListener("click", resetRace);

resetRace();
