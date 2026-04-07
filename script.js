const canvas = document.getElementById("raceCanvas");
const ctx = canvas.getContext("2d");

const startBtn = document.getElementById("startBtn");
const boostMeBtn = document.getElementById("boostMeBtn");
const slowMeBtn = document.getElementById("slowMeBtn");
const boostOthersBtn = document.getElementById("boostOthersBtn");
const slowOthersBtn = document.getElementById("slowOthersBtn");
const resetBtn = document.getElementById("resetBtn");
const raceDurationInput = document.getElementById("raceDurationInput");

const raceState = document.getElementById("raceState");
const distanceLeft = document.getElementById("distanceLeft");
const leaderName = document.getElementById("leaderName");
const currentSpeed = document.getElementById("currentSpeed");
const myProgress = document.getElementById("myProgress");
const announcement = document.getElementById("announcement");

const DISTANCE_METERS = 1800;
const DEFAULT_RACE_DURATION_SECONDS = 60;
const BOOST_AMOUNT = 0.2;
const TRACK_WIDTH = 108;
const LANE_OFFSETS = [-30, -10, 10, 30];

const TRACK_SEGMENTS = [
    {
        type: "curve",
        from: { x: 296, y: 598 },
        cp1: { x: 176, y: 602 },
        cp2: { x: 126, y: 492 },
        to: { x: 208, y: 402 }
    },
    {
        type: "curve",
        from: { x: 208, y: 402 },
        cp1: { x: 266, y: 336 },
        cp2: { x: 308, y: 244 },
        to: { x: 288, y: 166 }
    },
    {
        type: "curve",
        from: { x: 288, y: 166 },
        cp1: { x: 394, y: 150 },
        cp2: { x: 456, y: 266 },
        to: { x: 396, y: 382 }
    },
    {
        type: "curve",
        from: { x: 396, y: 382 },
        cp1: { x: 334, y: 484 },
        cp2: { x: 382, y: 600 },
        to: { x: 500, y: 596 }
    },
    {
        type: "curve",
        from: { x: 500, y: 596 },
        cp1: { x: 620, y: 590 },
        cp2: { x: 668, y: 474 },
        to: { x: 558, y: 388 }
    },
    {
        type: "curve",
        from: { x: 558, y: 388 },
        cp1: { x: 486, y: 332 },
        cp2: { x: 450, y: 234 },
        to: { x: 496, y: 150 }
    },
    {
        type: "curve",
        from: { x: 496, y: 150 },
        cp1: { x: 604, y: 162 },
        cp2: { x: 680, y: 280 },
        to: { x: 560, y: 386 }
    },
    {
        type: "curve",
        from: { x: 560, y: 386 },
        cp1: { x: 452, y: 484 },
        cp2: { x: 430, y: 602 },
        to: { x: 296, y: 598 }
    },
];

let racers = [];
let racing = false;
let winner = null;
let animationId = null;
let lastFrameTime = 0;
let pathSamples = [];
let trackLength = 0;
let raceDurationMs = DEFAULT_RACE_DURATION_SECONDS * 1000;

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

function getBaseProgressStep() {
    const referencePlayerSpeed = 1.04;
    return 1 / ((raceDurationMs / 16.6667) * referencePlayerSpeed);
}

function getProgressBounds() {
    const baseStep = getBaseProgressStep();
    return {
        baseStep,
        minStep: baseStep * 0.55,
        maxStep: baseStep * 1.85
    };
}

function syncRaceDuration() {
    const parsedValue = Number.parseInt(raceDurationInput.value, 10);
    const seconds = clamp(Number.isFinite(parsedValue) ? parsedValue : DEFAULT_RACE_DURATION_SECONDS, 20, 300);
    raceDurationInput.value = String(seconds);
    raceDurationMs = seconds * 1000;
}

function buildPathSamples() {
    pathSamples = [];
    trackLength = 0;

    const samples = [];
    TRACK_SEGMENTS.forEach((segment) => {
        const resolution = segment.type === "line" ? 28 : 42;
        for (let step = 0; step <= resolution; step += 1) {
            if (samples.length > 0 && step === 0) {
                continue;
            }

            const t = step / resolution;
            let x;
            let y;
            let dx;
            let dy;

            if (segment.type === "line") {
                x = lerp(segment.from.x, segment.to.x, t);
                y = lerp(segment.from.y, segment.to.y, t);
                dx = segment.to.x - segment.from.x;
                dy = segment.to.y - segment.from.y;
            } else {
                x = cubicBezier(segment.from.x, segment.cp1.x, segment.cp2.x, segment.to.x, t);
                y = cubicBezier(segment.from.y, segment.cp1.y, segment.cp2.y, segment.to.y, t);
                dx = cubicDerivative(segment.from.x, segment.cp1.x, segment.cp2.x, segment.to.x, t);
                dy = cubicDerivative(segment.from.y, segment.cp1.y, segment.cp2.y, segment.to.y, t);
            }

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
    });

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
        createRacer("npc1", "GROC 2025 챔피언", "#ff6f91", 1, 0.98, "CPU"),
        createRacer("npc2", "이번달 1위", "#ffd166", 2, 1.01, "CPU"),
        createRacer("npc3", "내 친구", "#75a9ff", 3, 0.96, "CPU")
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
    ctx.fillText("FIGURE EIGHT CIRCUIT", canvas.width / 2, 58);

    ctx.font = "600 14px Segoe UI";
    ctx.fillStyle = "rgba(226,232,240,0.82)";
    ctx.fillText("Flowing Crossover With Natural Corners", canvas.width / 2, 84);
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

    const { baseStep, minStep, maxStep } = getProgressBounds();

    racers.forEach((racer) => {
        const randomFactor = 0.88 + Math.random() * 0.32;
        const deltaBoost = delta / 16.6667;
        const step = clamp(racer.speed * baseStep * randomFactor * deltaBoost, minStep, maxStep);
        racer.progress = clamp(racer.progress + step, 0, 1);
    });

    const finisher = racers.find((racer) => racer.progress >= 1);
    if (finisher) {
        winner = finisher;
        racing = false;
        announcement.textContent = `${finisher.name}가 기하학적인 서킷을 가장 먼저 완주했습니다.`;
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

    syncRaceDuration();
    racing = true;
    announcement.textContent = `${Math.round(raceDurationMs / 1000)}초 설정의 8자 서킷 레이스가 시작됐습니다.`;
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

function slowMe() {
    const me = racers.find((racer) => racer.id === "me");
    me.speed = clamp(me.speed - BOOST_AMOUNT, 0.6, 2.4);
    announcement.textContent = `내 레이서의 속도가 ${me.speed.toFixed(2)}배로 내려갔습니다.`;
    updateUi();
    renderScene(performance.now());
}

function slowOthers() {
    racers
        .filter((racer) => racer.id !== "me")
        .forEach((racer) => {
            racer.speed = clamp(racer.speed - BOOST_AMOUNT, 0.6, 2.4);
        });

    announcement.textContent = "다른 레이서들의 속도를 낮춰서 추격 흐름이 느려졌습니다.";
    updateUi();
    renderScene(performance.now());
}

function resetRace() {
    racing = false;
    winner = null;
    lastFrameTime = 0;
    syncRaceDuration();

    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }

    racers = createInitialRacers();
    announcement.textContent = "출발 버튼을 누르면 8자 코스 레이스가 시작됩니다.";
    renderScene(performance.now());
    updateUi();
}

buildPathSamples();
syncRaceDuration();

startBtn.addEventListener("click", startRace);
boostMeBtn.addEventListener("click", boostMe);
slowMeBtn.addEventListener("click", slowMe);
boostOthersBtn.addEventListener("click", boostOthers);
slowOthersBtn.addEventListener("click", slowOthers);
resetBtn.addEventListener("click", resetRace);
raceDurationInput.addEventListener("change", syncRaceDuration);

resetRace();
