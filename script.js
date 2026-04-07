const raceCanvas = document.getElementById("raceCanvas");
const raceCtx = raceCanvas.getContext("2d");
const gaugeCanvas = document.getElementById("gaugeCanvas");
const gaugeCtx = gaugeCanvas.getContext("2d");

const courseDisplay = document.getElementById("courseDisplay");
const telemetryDisplay = document.getElementById("telemetryDisplay");
const cockpitScene = document.getElementById("cockpitScene");

const startBtn = document.getElementById("startBtn");
const boostMeBtn = document.getElementById("boostMeBtn");
const slowMeBtn = document.getElementById("slowMeBtn");
const boostOthersBtn = document.getElementById("boostOthersBtn");
const slowOthersBtn = document.getElementById("slowOthersBtn");
const resetBtn = document.getElementById("resetBtn");
const modeToggleBtn = document.getElementById("modeToggleBtn");
const raceDurationInput = document.getElementById("raceDurationInput");

const raceState = document.getElementById("raceState");
const distanceLeft = document.getElementById("distanceLeft");
const leaderName = document.getElementById("leaderName");
const currentSpeed = document.getElementById("currentSpeed");
const myProgress = document.getElementById("myProgress");
const announcement = document.getElementById("announcement");

const DISTANCE_METERS = 1800;
const DEFAULT_RACE_DURATION_SECONDS = 20;
const BOOST_AMOUNT = 0.18;
const VIEW_DISTANCE = 0.18;
const PLAYER_SPEED_RANGE = { min: 0.96, max: 1.08 };
const SPEED_LIMITS = { min: 0.7, max: 1.95 };
const OPPONENT_SPEED_VARIANCE = 0.07;
const TOP_DISPLAY_SPEED = 190;

const OPPONENT_POOL = [
    { id: "champion", name: "Champion", speed: 1.0, color: "#ff6870" },
    { id: "rocket", name: "Rocket", speed: 1.04, color: "#ffc14f" },
    { id: "phantom", name: "Phantom", speed: 0.98, color: "#7cd7ff" },
    { id: "twin", name: "Twin", speed: 1.02, color: "#ff9de4" }
];

let racers = [];
let racing = false;
let winner = null;
let animationId = null;
let lastFrameTime = 0;
let raceDurationMs = DEFAULT_RACE_DURATION_SECONDS * 1000;
let lastLeaderId = null;
let audioEnabled = false;
let currentSpeedKmh = 0;
let gaugeSpeedKmh = 0;
let raceMode = "downhill";

const winAudio = new Audio("win.mp3");
const loseAudio = new Audio("loose.mp3");

winAudio.preload = "auto";
loseAudio.preload = "auto";

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function lerp(start, end, ratio) {
    return start + (end - start) * ratio;
}

function mapRange(value, inputMin, inputMax, outputMin, outputMax) {
    if (inputMax === inputMin) {
        return outputMin;
    }

    const ratio = (value - inputMin) / (inputMax - inputMin);
    return lerp(outputMin, outputMax, ratio);
}

function randomBetween(min, max) {
    return min + Math.random() * (max - min);
}

function hexToRgba(hex, alpha) {
    const normalized = hex.replace("#", "");
    const bigint = Number.parseInt(normalized, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function addRoundedRectPath(context, x, y, width, height, radius) {
    const safeRadius = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + safeRadius, y);
    context.arcTo(x + width, y, x + width, y + height, safeRadius);
    context.arcTo(x + width, y + height, x, y + height, safeRadius);
    context.arcTo(x, y + height, x, y, safeRadius);
    context.arcTo(x, y, x + width, y, safeRadius);
    context.closePath();
}

function fillRoundedRect(context, x, y, width, height, radius, fillStyle) {
    addRoundedRectPath(context, x, y, width, height, radius);
    context.fillStyle = fillStyle;
    context.fill();
}

function strokeRoundedRect(context, x, y, width, height, radius, strokeStyle, lineWidth) {
    addRoundedRectPath(context, x, y, width, height, radius);
    context.lineWidth = lineWidth;
    context.strokeStyle = strokeStyle;
    context.stroke();
}

function fillQuad(context, points, fillStyle) {
    context.fillStyle = fillStyle;
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    context.lineTo(points[1].x, points[1].y);
    context.lineTo(points[2].x, points[2].y);
    context.lineTo(points[3].x, points[3].y);
    context.closePath();
    context.fill();
}

function getPlayer() {
    return racers.find((racer) => racer.id === "me") || null;
}

function getOpponent() {
    return racers.find((racer) => racer.id !== "me") || null;
}

function getLeader() {
    return racers.reduce((currentLeader, racer) => {
        if (!currentLeader || racer.progress > currentLeader.progress) {
            return racer;
        }

        return currentLeader;
    }, null);
}

function getBaseProgressStep() {
    const referencePlayerSpeed = 1.02;
    return 1 / ((raceDurationMs / 16.6667) * referencePlayerSpeed);
}

function getProgressBounds() {
    const baseStep = getBaseProgressStep();
    return {
        baseStep,
        minStep: baseStep * 0.55,
        maxStep: baseStep * 1.8
    };
}

function getCourseCurve(progress) {
    const t = progress * Math.PI * 2;
    return (
        Math.sin(t * 1.05 - 0.6) * 0.68 +
        Math.sin(t * 2.8 + 0.9) * 0.28 +
        Math.cos(t * 4.2 - 0.1) * 0.12
    );
}

function getCourseBank(progress) {
    const t = progress * Math.PI * 2;
    return Math.sin(t * 1.6 + 1.2) * 0.55 + Math.cos(t * 3.2 - 0.2) * 0.15;
}

function getCurveLabel(curve) {
    if (curve <= -0.48) {
        return "Hard Left";
    }

    if (curve <= -0.16) {
        return "Left Corner";
    }

    if (curve >= 0.48) {
        return "Hard Right";
    }

    if (curve >= 0.16) {
        return "Right Corner";
    }

    return "Full Straight";
}

function getRaceStateText() {
    if (winner) {
        return `${winner.name} wins`;
    }

    return racing ? "Racing" : "Standby";
}

function getMatchupState() {
    const me = getPlayer();
    const opponent = getOpponent();

    if (!me || !opponent) {
        return null;
    }

    if (Math.abs(me.progress - opponent.progress) < 0.0001) {
        return "even";
    }

    return me.progress > opponent.progress ? "ahead" : "behind";
}

function playAudioClip(audio) {
    audio.currentTime = 0;
    audio.play().catch(() => {
        // Ignore browser autoplay restrictions.
    });
}

function playLeadAudio(leader) {
    if (!audioEnabled || !leader) {
        return;
    }

    if (leader.id === "me") {
        loseAudio.pause();
        loseAudio.currentTime = 0;
        playAudioClip(winAudio);
        return;
    }

    winAudio.pause();
    winAudio.currentTime = 0;
    playAudioClip(loseAudio);
}

function stopRaceAudio() {
    winAudio.pause();
    loseAudio.pause();
    winAudio.currentTime = 0;
    loseAudio.currentTime = 0;
}

function triggerCourseDisplayEffect(className) {
    courseDisplay.classList.remove("overtake-boost", "overtake-hit");
    void courseDisplay.offsetWidth;
    courseDisplay.classList.add(className);
}

function syncRaceDuration() {
    const parsedValue = Number.parseInt(raceDurationInput.value, 10);
    const seconds = clamp(
        Number.isFinite(parsedValue) ? parsedValue : DEFAULT_RACE_DURATION_SECONDS,
        20,
        300
    );

    raceDurationInput.value = String(seconds);
    raceDurationMs = seconds * 1000;
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
    const opponent = OPPONENT_POOL[Math.floor(Math.random() * OPPONENT_POOL.length)];
    const playerSpeed = randomBetween(PLAYER_SPEED_RANGE.min, PLAYER_SPEED_RANGE.max);
    const opponentSpeed = clamp(
        opponent.speed + randomBetween(-OPPONENT_SPEED_VARIANCE, OPPONENT_SPEED_VARIANCE),
        SPEED_LIMITS.min,
        SPEED_LIMITS.max
    );

    return [
        createRacer("me", "Player", "#79ffb2", 0, playerSpeed, "PLAYER"),
        createRacer(opponent.id, opponent.name, opponent.color, 1, opponentSpeed, "CPU")
    ];
}

function setupRace() {
    racing = false;
    winner = null;
    racers = createInitialRacers();
    lastLeaderId = null;
    audioEnabled = false;
    currentSpeedKmh = 0;
    gaugeSpeedKmh = 0;
    courseDisplay.classList.remove("overtake-boost", "overtake-hit");
    telemetryDisplay.classList.remove("speed-hot");
    stopRaceAudio();
}

function getRoadSlice(depth, progress, speedRatio) {
    const horizonY = 174 - speedRatio * 8 - getCourseBank(progress) * 10;
    const previewProgress = progress + depth * VIEW_DISTANCE;
    const curvePreview = getCourseCurve(previewProgress);
    const depthCurve = Math.pow(depth, 1.18);
    const y = lerp(horizonY, raceCanvas.height * 0.92, Math.pow(depth, 1.08));
    const roadWidth = lerp(84, 576, Math.pow(depth, 1.3));
    const centerX = raceCanvas.width / 2
        + getCourseCurve(progress) * 54
        + curvePreview * (44 + depthCurve * 270)
        + Math.sin(previewProgress * 14) * 6 * (1 - depth);
    const shoulder = roadWidth * 0.12;
    const laneWidth = roadWidth * 0.19;

    return {
        y,
        centerX,
        roadWidth,
        shoulder,
        laneWidth
    };
}

function drawMountainLayer(context, canvas, baseY, amplitude, color, shift, opacityBoost) {
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(0, canvas.height);

    for (let step = 0; step <= 8; step += 1) {
        const x = (step / 8) * canvas.width;
        const wave = Math.sin(step * 0.92 + shift) * amplitude;
        const ridge = Math.cos(step * 1.31 - shift * 0.6) * amplitude * opacityBoost;
        context.lineTo(x, baseY - wave - ridge);
    }

    context.lineTo(canvas.width, canvas.height);
    context.closePath();
    context.fill();
}

function drawRaceBackgroundOn(context, canvas, progress, speedRatio) {
    const hue = 197 + Math.sin(progress * Math.PI * 2) * 10;
    const sky = context.createLinearGradient(0, 0, 0, canvas.height * 0.64);
    sky.addColorStop(0, `hsl(${hue} 78% 72%)`);
    sky.addColorStop(0.54, `hsl(${hue + 8} 74% 58%)`);
    sky.addColorStop(1, "#d8f1ff");
    context.fillStyle = sky;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = "rgba(255, 255, 255, 0.16)";
    context.beginPath();
    context.arc(132, 96, 38 + speedRatio * 6, 0, Math.PI * 2);
    context.fill();

    drawMountainLayer(context, canvas, 234, 58, "rgba(33, 88, 94, 0.48)", progress * 8, 0.45);
    drawMountainLayer(context, canvas, 274, 42, "rgba(58, 123, 88, 0.62)", progress * 6.4 + 0.8, 0.32);

    context.fillStyle = "rgba(255, 255, 255, 0.08)";
    for (let cloud = 0; cloud < 5; cloud += 1) {
        const x = 92 + cloud * 134 + Math.sin(progress * 10 + cloud) * 10;
        const y = 88 + (cloud % 2) * 26;
        context.beginPath();
        context.arc(x, y, 18, 0, Math.PI * 2);
        context.arc(x + 18, y - 6, 14, 0, Math.PI * 2);
        context.arc(x + 34, y, 17, 0, Math.PI * 2);
        context.fill();
    }
}

function drawRaceBackground(progress, speedRatio) {
    drawRaceBackgroundOn(raceCtx, raceCanvas, progress, speedRatio);
}

function drawTrackOn(context, canvas, progress, speedRatio) {
    const stripCount = 72;
    const stripOffset = Math.floor(progress * 900);

    for (let index = 0; index < stripCount; index += 1) {
        const farDepth = index / stripCount;
        const nearDepth = (index + 1) / stripCount;
        const far = getRoadSlice(farDepth, progress, speedRatio);
        const near = getRoadSlice(nearDepth, progress, speedRatio);

        const grassColor = (stripOffset + index) % 2 === 0 ? "#77c84e" : "#67b142";
        context.fillStyle = grassColor;
        context.fillRect(0, far.y, canvas.width, near.y - far.y + 2);

        const farRoadHalf = far.roadWidth / 2;
        const nearRoadHalf = near.roadWidth / 2;
        const farOuterHalf = farRoadHalf + far.shoulder;
        const nearOuterHalf = nearRoadHalf + near.shoulder;
        const roadShade = 52 + nearDepth * 22;
        const roadColor = `rgb(${roadShade}, ${roadShade + 2}, ${roadShade + 8})`;
        const curbColor = (stripOffset + index) % 2 === 0 ? "#fff8f0" : "#ff624e";

        fillQuad(context, [
            { x: far.centerX - farOuterHalf, y: far.y },
            { x: far.centerX - farRoadHalf, y: far.y },
            { x: near.centerX - nearRoadHalf, y: near.y },
            { x: near.centerX - nearOuterHalf, y: near.y }
        ], curbColor);

        fillQuad(context, [
            { x: far.centerX + farRoadHalf, y: far.y },
            { x: far.centerX + farOuterHalf, y: far.y },
            { x: near.centerX + nearOuterHalf, y: near.y },
            { x: near.centerX + nearRoadHalf, y: near.y }
        ], curbColor);

        fillQuad(context, [
            { x: far.centerX - farRoadHalf, y: far.y },
            { x: far.centerX + farRoadHalf, y: far.y },
            { x: near.centerX + nearRoadHalf, y: near.y },
            { x: near.centerX - nearRoadHalf, y: near.y }
        ], roadColor);

        if (index % 6 < 3 && index > 4) {
            const stripeWidthFar = Math.max(3, far.roadWidth * 0.018);
            const stripeWidthNear = Math.max(4, near.roadWidth * 0.026);

            fillQuad(context, [
                { x: far.centerX - stripeWidthFar, y: far.y },
                { x: far.centerX + stripeWidthFar, y: far.y },
                { x: near.centerX + stripeWidthNear, y: near.y },
                { x: near.centerX - stripeWidthNear, y: near.y }
            ], "rgba(255, 255, 255, 0.78)");
        }
    }

    const edgeGlow = context.createLinearGradient(0, canvas.height * 0.24, 0, canvas.height);
    edgeGlow.addColorStop(0, "rgba(255,255,255,0)");
    edgeGlow.addColorStop(1, "rgba(255,255,255,0.08)");
    context.fillStyle = edgeGlow;
    context.fillRect(0, canvas.height * 0.24, canvas.width, canvas.height * 0.72);
}

function drawTrack(progress, speedRatio) {
    drawTrackOn(raceCtx, raceCanvas, progress, speedRatio);
}

function drawFinishLineMarkerOn(context, progress, speedRatio) {
    const leader = getLeader();
    if (!leader) {
        return;
    }

    const showStartProgress = 0.82;
    if (leader.progress < showStartProgress) {
        return;
    }

    const approach = clamp((leader.progress - showStartProgress) / (1 - showStartProgress), 0, 1);
    const depth = lerp(0.28, 0.9, approach);
    const finishSlice = getRoadSlice(depth, progress, speedRatio);
    const bandHeight = lerp(10, 42, approach);
    const roadLeft = finishSlice.centerX - finishSlice.roadWidth / 2;
    const checkerCols = 12;
    const checkerRows = 2;
    const tileWidth = finishSlice.roadWidth / checkerCols;
    const tileHeight = bandHeight / checkerRows;
    const alpha = 0.4 + approach * 0.55;

    for (let row = 0; row < checkerRows; row += 1) {
        for (let col = 0; col < checkerCols; col += 1) {
            context.fillStyle = (row + col) % 2 === 0
                ? `rgba(250, 252, 255, ${alpha})`
                : `rgba(22, 28, 36, ${Math.min(0.92, alpha + 0.2)})`;
            context.fillRect(
                roadLeft + col * tileWidth,
                finishSlice.y - bandHeight,
                tileWidth + 1,
                tileHeight + 1
            );
        }
    }

    context.fillStyle = `rgba(255, 255, 255, ${0.52 + approach * 0.42})`;
    context.font = `700 ${Math.round(18 + approach * 12)}px Bahnschrift, Segoe UI, sans-serif`;
    context.textAlign = "center";
    context.fillText("FINISH", finishSlice.centerX, finishSlice.y - bandHeight - (12 + approach * 10));
    context.textAlign = "start";
}

function drawFinishLineMarker(progress, speedRatio) {
    drawFinishLineMarkerOn(raceCtx, progress, speedRatio);
}

function drawRaceCarSprite(context, racer, x, y, scale, elapsed, isLeader) {
    const width = 100 * scale;
    const height = 48 * scale;
    const bob = Math.sin(elapsed * 0.009 + racer.wobbleSeed) * 2.2;

    context.save();
    context.translate(x, y + bob);

    const glow = context.createRadialGradient(0, height * 0.1, 8, 0, 0, width);
    glow.addColorStop(0, hexToRgba(racer.color, isLeader ? 0.46 : 0.28));
    glow.addColorStop(1, hexToRgba(racer.color, 0));
    context.fillStyle = glow;
    context.beginPath();
    context.ellipse(0, 0, width * 0.95, height * 1.05, 0, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "rgba(6, 10, 16, 0.34)";
    context.beginPath();
    context.ellipse(0, height * 0.72, width * 0.78, height * 0.36, 0, 0, Math.PI * 2);
    context.fill();

    fillRoundedRect(context, -width / 2, -height * 0.42, width, height, 16 * scale, racer.color);
    fillRoundedRect(context, -width * 0.25, -height * 0.88, width * 0.5, height * 0.38, 11 * scale, "#edf4ff");
    fillRoundedRect(context, -width * 0.52, -height * 0.04, width * 0.18, height * 0.52, 8 * scale, "#0f141b");
    fillRoundedRect(context, width * 0.34, -height * 0.04, width * 0.18, height * 0.52, 8 * scale, "#0f141b");
    fillRoundedRect(context, -width * 0.58, -height * 0.45, width * 0.18, height * 0.26, 6 * scale, "#171d24");
    fillRoundedRect(context, width * 0.4, -height * 0.45, width * 0.18, height * 0.26, 6 * scale, "#171d24");

    if (isLeader) {
        strokeRoundedRect(
            context,
            -width * 0.58,
            -height * 0.58,
            width * 1.16,
            height * 1.06,
            20 * scale,
            "rgba(255, 255, 255, 0.8)",
            Math.max(2, 4 * scale)
        );
    }

    context.fillStyle = "rgba(255, 255, 255, 0.96)";
    context.font = `${Math.max(16, Math.round(20 * scale))}px Bahnschrift, Segoe UI, sans-serif`;
    context.textAlign = "center";
    context.fillText(racer.name, 0, -height * 1.22);

    context.restore();
}

function drawCenterRacePair(progress, elapsed, speedRatio) {
    const pairState = getBattlePairState(progress, speedRatio);
    if (!pairState) {
        return;
    }

    const { pairCenterX, pairCenterY, lateralSpread, mePosition, opponentPosition, me, opponent } = pairState;

    raceCtx.fillStyle = "rgba(255, 255, 255, 0.08)";
    raceCtx.beginPath();
    raceCtx.ellipse(pairCenterX, pairCenterY + 34, lateralSpread * 0.98, 30, 0, 0, Math.PI * 2);
    raceCtx.fill();

    const drawOrder = [
        { racer: me, ...mePosition },
        { racer: opponent, ...opponentPosition }
    ].sort((a, b) => a.scale - b.scale);

    drawOrder.forEach((entry) => {
        drawRaceCarSprite(raceCtx, entry.racer, entry.x, entry.y, entry.scale, elapsed, entry.isLeader);
    });
}

function drawPlayerOnlyRacePair(progress, elapsed, speedRatio) {
    const me = getPlayer();
    const leader = getLeader();

    if (!me) {
        return;
    }

    const splitSlice = getRoadSlice(0.66, progress, speedRatio);
    const yBase = splitSlice.y - 34;
    drawRaceCarSprite(raceCtx, me, splitSlice.centerX, yBase, 1.04, elapsed, Boolean(leader && leader.id === me.id));
}

function getBattlePairState(progress, speedRatio) {
    const me = getPlayer();
    const opponent = getOpponent();

    if (!me || !opponent) {
        return null;
    }

    const battleSlice = getRoadSlice(0.64, progress, speedRatio);
    const gapMeters = (me.progress - opponent.progress) * DISTANCE_METERS;
    const normalizedGap = clamp(Math.abs(gapMeters) / 160, 0, 1);
    const leadBlend = clamp(mapRange(gapMeters, -120, 120, 0, 1), 0, 1);
    const lateralSpread = battleSlice.laneWidth * 1.9 + normalizedGap * 16;
    const pairCenterX = battleSlice.centerX;
    const pairCenterY = battleSlice.y - 26;

    const meAhead = gapMeters >= 0;
    const frontY = pairCenterY - (58 + normalizedGap * 30);
    const rearY = pairCenterY + (18 + normalizedGap * 12);
    const frontScale = 0.82 - normalizedGap * 0.08;
    const rearScale = 1.02 - normalizedGap * 0.04;

    const mePosition = {
        x: pairCenterX - lateralSpread / 2,
        y: lerp(rearY, frontY, leadBlend),
        scale: lerp(rearScale, frontScale, leadBlend),
        isLeader: meAhead
    };
    const opponentPosition = {
        x: pairCenterX + lateralSpread / 2,
        y: lerp(frontY, rearY, leadBlend),
        scale: lerp(frontScale, rearScale, leadBlend),
        isLeader: !meAhead
    };

    return { me, opponent, pairCenterX, pairCenterY, lateralSpread, mePosition, opponentPosition };
}

function drawRaceHud(curve) {
    const me = getPlayer();
    const opponent = getOpponent();
    const leader = getLeader();
    const myDistance = me ? Math.round(me.progress * DISTANCE_METERS) : 0;
    const progressRatio = me ? me.progress : 0;
    const gapMeters = me && opponent ? Math.round((me.progress - opponent.progress) * DISTANCE_METERS) : 0;
    const gapText = gapMeters >= 0 ? `+${gapMeters}m lead` : `${Math.abs(gapMeters)}m chase`;
    const positionText = leader && leader.id === "me" ? "1 / 2" : "2 / 2";

    fillRoundedRect(raceCtx, 24, 24, 190, 48, 20, "rgba(7, 13, 21, 0.56)");
    fillRoundedRect(raceCtx, 542, 24, 194, 48, 20, "rgba(7, 13, 21, 0.56)");
    fillRoundedRect(raceCtx, 24, 84, 230, 108, 24, "rgba(7, 13, 21, 0.44)");
    fillRoundedRect(raceCtx, 514, 84, 222, 108, 24, "rgba(7, 13, 21, 0.44)");
    fillRoundedRect(raceCtx, 214, 684, 332, 44, 22, "rgba(7, 13, 21, 0.56)");

    raceCtx.fillStyle = "#87ffc7";
    raceCtx.font = "700 18px Bahnschrift, Segoe UI, sans-serif";
    raceCtx.fillText("LEFT DISPLAY", 42, 54);
    raceCtx.fillStyle = "rgba(255,255,255,0.8)";
    raceCtx.fillText("LIVE RACE VIEW", 560, 54);

    raceCtx.fillStyle = "rgba(255,255,255,0.72)";
    raceCtx.font = "600 20px Bahnschrift, Segoe UI, sans-serif";
    raceCtx.fillText("STATE", 48, 118);
    raceCtx.fillText("POSITION", 542, 118);
    raceCtx.fillText("TRACK", 48, 154);
    raceCtx.fillText("GAP", 542, 154);

    raceCtx.fillStyle = "#ffffff";
    raceCtx.font = "700 26px Bahnschrift, Segoe UI, sans-serif";
    raceCtx.fillText(getRaceStateText(), 104, 148);
    raceCtx.fillText(positionText, 604, 148);
    raceCtx.fillText(getCurveLabel(curve), 104, 184);
    raceCtx.fillText(gapText, 604, 184);

    raceCtx.fillStyle = "rgba(255,255,255,0.7)";
    raceCtx.font = "600 18px Bahnschrift, Segoe UI, sans-serif";
    raceCtx.textAlign = "center";
    raceCtx.fillText(`My progress ${myDistance}m`, raceCanvas.width / 2, 712);
    raceCtx.textAlign = "start";

    fillRoundedRect(raceCtx, 238, 694, 286, 16, 10, "rgba(255,255,255,0.12)");
    const progressGradient = raceCtx.createLinearGradient(238, 0, 524, 0);
    progressGradient.addColorStop(0, "#79ffb2");
    progressGradient.addColorStop(1, "#56b5ff");
    fillRoundedRect(raceCtx, 238, 694, 286 * progressRatio, 16, 10, progressGradient);
}

function drawRaceDisplay(elapsed) {
    const me = getPlayer();
    const progress = me ? me.progress : 0;
    const speedRatio = clamp(currentSpeedKmh / TOP_DISPLAY_SPEED, 0, 1);
    const curve = getCourseCurve(progress);

    raceCtx.clearRect(0, 0, raceCanvas.width, raceCanvas.height);
    drawRaceBackground(progress, speedRatio);
    drawTrack(progress, speedRatio);
    drawFinishLineMarker(progress, speedRatio);
    if (raceMode === "uphill") {
        drawPlayerOnlyRacePair(progress, elapsed, speedRatio);
    } else {
        drawCenterRacePair(progress, elapsed, speedRatio);
    }
    drawRaceHud(curve);
}

function updateModeToggleUi() {
    if (!modeToggleBtn) {
        return;
    }

    modeToggleBtn.textContent = `Mode: ${raceMode === "uphill" ? "Uphill" : "Downhill"}`;
}

function toggleRaceMode() {
    raceMode = raceMode === "downhill" ? "uphill" : "downhill";
    updateModeToggleUi();
    announcement.textContent = raceMode === "uphill"
        ? "Uphill mode: left side shows Player only, right side shows Rival only."
        : "Downhill mode: race display is back to the original mixed battle view.";
}

function speedToAngle(speed) {
    const startAngle = Math.PI * 0.78;
    const endAngle = Math.PI * 2.22;
    return mapRange(speed, 0, TOP_DISPLAY_SPEED, startAngle, endAngle);
}

function drawGaugeChip(x, y, width, label, value, accentColor) {
    fillRoundedRect(gaugeCtx, x, y, width, 56, 22, "rgba(255, 255, 255, 0.04)");
    strokeRoundedRect(gaugeCtx, x, y, width, 56, 22, "rgba(255, 255, 255, 0.06)", 1);

    gaugeCtx.fillStyle = "rgba(255,255,255,0.6)";
    gaugeCtx.font = "600 16px Bahnschrift, Segoe UI, sans-serif";
    gaugeCtx.textAlign = "center";
    gaugeCtx.textBaseline = "alphabetic";
    gaugeCtx.fillText(label, x + width / 2, y + 20);

    gaugeCtx.fillStyle = accentColor;
    gaugeCtx.font = "700 24px Bahnschrift, Segoe UI, sans-serif";
    gaugeCtx.fillText(value, x + width / 2, y + 42);
}

function drawOpponentOnlyDisplay(elapsed) {
    const opponent = getOpponent();
    const me = getPlayer();
    const progress = me ? me.progress : 0;
    const speedRatio = clamp(currentSpeedKmh / TOP_DISPLAY_SPEED, 0, 1);

    gaugeCtx.clearRect(0, 0, gaugeCanvas.width, gaugeCanvas.height);
    drawRaceBackgroundOn(gaugeCtx, gaugeCanvas, progress, speedRatio);
    drawTrackOn(gaugeCtx, gaugeCanvas, progress, speedRatio);
    drawFinishLineMarkerOn(gaugeCtx, progress, speedRatio);

    const pairState = getBattlePairState(progress, speedRatio);

    if (opponent && pairState) {
        drawRaceCarSprite(
            gaugeCtx,
            opponent,
            pairState.opponentPosition.x,
            pairState.opponentPosition.y,
            pairState.opponentPosition.scale,
            elapsed,
            pairState.opponentPosition.isLeader
        );
    }
}

function drawGaugeDisplay(elapsed) {
    if (raceMode === "uphill") {
        drawOpponentOnlyDisplay(elapsed);
        return;
    }

    const me = getPlayer();
    const opponent = getOpponent();
    const leader = getLeader();
    const progress = me ? me.progress : 0;
    const remaining = leader
        ? Math.max(0, DISTANCE_METERS - Math.round(leader.progress * DISTANCE_METERS))
        : DISTANCE_METERS;
    const gapMeters = me && opponent ? Math.round((me.progress - opponent.progress) * DISTANCE_METERS) : 0;
    const centerX = gaugeCanvas.width / 2;
    const centerY = gaugeCanvas.height / 2;
    const radius = 252;
    const displaySpeed = Math.round(gaugeSpeedKmh);
    const rpm = Math.round(mapRange(displaySpeed, 0, TOP_DISPLAY_SPEED, 900, 7800));
    const needleAngle = speedToAngle(gaugeSpeedKmh);
    const zoneStart = speedToAngle(0);
    const zoneEnd = speedToAngle(TOP_DISPLAY_SPEED);

    gaugeCtx.clearRect(0, 0, gaugeCanvas.width, gaugeCanvas.height);

    const face = gaugeCtx.createRadialGradient(centerX, centerY - 40, 30, centerX, centerY, 360);
    face.addColorStop(0, "#19222c");
    face.addColorStop(0.54, "#091119");
    face.addColorStop(1, "#02070b");
    gaugeCtx.fillStyle = face;
    gaugeCtx.fillRect(0, 0, gaugeCanvas.width, gaugeCanvas.height);

    gaugeCtx.strokeStyle = "rgba(255,255,255,0.08)";
    gaugeCtx.lineWidth = 28;
    gaugeCtx.beginPath();
    gaugeCtx.arc(centerX, centerY, radius, zoneStart, zoneEnd);
    gaugeCtx.stroke();

    const activeArc = gaugeCtx.createLinearGradient(160, 100, 620, 620);
    activeArc.addColorStop(0, "#79ffb2");
    activeArc.addColorStop(0.58, "#56b5ff");
    activeArc.addColorStop(0.88, "#ffb04a");
    activeArc.addColorStop(1, "#ff6169");
    gaugeCtx.strokeStyle = activeArc;
    gaugeCtx.lineWidth = 20;
    gaugeCtx.beginPath();
    gaugeCtx.arc(centerX, centerY, radius, zoneStart, needleAngle);
    gaugeCtx.stroke();

    gaugeCtx.strokeStyle = "rgba(255, 97, 105, 0.6)";
    gaugeCtx.lineWidth = 22;
    gaugeCtx.beginPath();
    gaugeCtx.arc(centerX, centerY, radius, speedToAngle(152), zoneEnd);
    gaugeCtx.stroke();

    for (let value = 0; value <= TOP_DISPLAY_SPEED; value += 10) {
        const angle = speedToAngle(value);
        const isMajor = value % 20 === 0;
        const inner = radius - (isMajor ? 56 : 34);
        const outer = radius - 8;
        const tickColor = value >= 150 ? "rgba(255,118,109,0.92)" : "rgba(255,255,255,0.82)";

        gaugeCtx.strokeStyle = tickColor;
        gaugeCtx.lineWidth = isMajor ? 5 : 2;
        gaugeCtx.beginPath();
        gaugeCtx.moveTo(
            centerX + Math.cos(angle) * inner,
            centerY + Math.sin(angle) * inner
        );
        gaugeCtx.lineTo(
            centerX + Math.cos(angle) * outer,
            centerY + Math.sin(angle) * outer
        );
        gaugeCtx.stroke();

        if (isMajor) {
            const labelRadius = radius - 92;
            gaugeCtx.fillStyle = "rgba(255,255,255,0.9)";
            gaugeCtx.font = "700 26px Bahnschrift, Segoe UI, sans-serif";
            gaugeCtx.textAlign = "center";
            gaugeCtx.textBaseline = "middle";
            gaugeCtx.fillText(
                String(value),
                centerX + Math.cos(angle) * labelRadius,
                centerY + Math.sin(angle) * labelRadius
            );
        }
    }

    drawGaugeChip(78, 126, 166, "LEADER", leader ? leader.name : "-", "#79ffb2");
    drawGaugeChip(516, 126, 166, "GAP", `${gapMeters >= 0 ? "+" : "-"}${Math.abs(gapMeters)}m`, "#56b5ff");

    gaugeCtx.fillStyle = "#ffffff";
    gaugeCtx.textAlign = "center";
    gaugeCtx.textBaseline = "middle";
    gaugeCtx.font = "800 148px Bahnschrift, Segoe UI, sans-serif";
    gaugeCtx.fillText(String(displaySpeed), centerX, centerY + 18);

    gaugeCtx.fillStyle = "rgba(255,255,255,0.82)";
    gaugeCtx.font = "700 36px Bahnschrift, Segoe UI, sans-serif";
    gaugeCtx.fillText("km/h", centerX, centerY + 104);

    gaugeCtx.fillStyle = "rgba(255,255,255,0.68)";
    gaugeCtx.font = "600 20px Bahnschrift, Segoe UI, sans-serif";
    gaugeCtx.fillText(getRaceStateText(), centerX, centerY - 110);
    gaugeCtx.fillText(getCurveLabel(getCourseCurve(progress)), centerX, centerY - 82);

    fillRoundedRect(gaugeCtx, centerX - 122, centerY + 156, 244, 64, 30, "rgba(255,255,255,0.06)");
    strokeRoundedRect(gaugeCtx, centerX - 122, centerY + 156, 244, 64, 30, "rgba(255,255,255,0.08)", 1);
    gaugeCtx.fillStyle = "rgba(255,255,255,0.56)";
    gaugeCtx.font = "600 18px Bahnschrift, Segoe UI, sans-serif";
    gaugeCtx.fillText("REMAINING", centerX, centerY + 182);
    gaugeCtx.fillStyle = "#ffffff";
    gaugeCtx.font = "800 44px Bahnschrift, Segoe UI, sans-serif";
    gaugeCtx.fillText(`${remaining}m`, centerX, centerY + 214);

    gaugeCtx.fillStyle = "rgba(255,255,255,0.56)";
    gaugeCtx.font = "600 18px Bahnschrift, Segoe UI, sans-serif";
    gaugeCtx.fillText(`RPM ${rpm}`, centerX, centerY + 256);

    const needleGradient = gaugeCtx.createLinearGradient(centerX, centerY, centerX + 140, centerY - 80);
    needleGradient.addColorStop(0, "rgba(255, 255, 255, 0.95)");
    needleGradient.addColorStop(1, "rgba(255, 192, 92, 0.95)");
    gaugeCtx.strokeStyle = needleGradient;
    gaugeCtx.lineWidth = 8;
    gaugeCtx.lineCap = "round";
    gaugeCtx.beginPath();
    gaugeCtx.moveTo(centerX, centerY);
    gaugeCtx.lineTo(
        centerX + Math.cos(needleAngle) * (radius - 84),
        centerY + Math.sin(needleAngle) * (radius - 84)
    );
    gaugeCtx.stroke();

    gaugeCtx.fillStyle = "#0f151d";
    gaugeCtx.beginPath();
    gaugeCtx.arc(centerX, centerY, 34, 0, Math.PI * 2);
    gaugeCtx.fill();
    gaugeCtx.fillStyle = "#f7f9fc";
    gaugeCtx.beginPath();
    gaugeCtx.arc(centerX, centerY, 14, 0, Math.PI * 2);
    gaugeCtx.fill();
}

function updateRace(delta, elapsed) {
    if (!racing) {
        return;
    }

    const matchupBefore = getMatchupState();
    const { baseStep, minStep, maxStep } = getProgressBounds();

    racers.forEach((racer) => {
        const curvePenalty = 1 - Math.abs(getCourseCurve(racer.progress + elapsed * 0.00003)) * 0.08;
        const randomFactor = 0.92 + Math.random() * 0.18;
        const deltaBoost = delta / 16.6667;
        const step = clamp(
            racer.speed * baseStep * curvePenalty * randomFactor * deltaBoost,
            minStep,
            maxStep
        );

        racer.progress = clamp(racer.progress + step, 0, 1);
    });

    const matchupAfter = getMatchupState();
    if (matchupBefore && matchupAfter && matchupBefore !== matchupAfter) {
        if (matchupBefore === "behind" && matchupAfter === "ahead") {
            triggerCourseDisplayEffect("overtake-boost");
        } else if (matchupBefore === "ahead" && matchupAfter === "behind") {
            triggerCourseDisplayEffect("overtake-hit");
        }
    }

    const finisher = racers.find((racer) => racer.progress >= 1);
    if (finisher) {
        winner = finisher;
        racing = false;
        playLeadAudio(finisher);
        announcement.textContent = `${finisher.name} crossed the finish line first. Both displays stay locked on the final race state.`;
    }
}

function updateMotionAndSpeed(elapsed) {
    const me = getPlayer();
    const speedRatio = clamp((me ? me.speed : 0) / SPEED_LIMITS.max, 0, 1);
    const progress = me ? me.progress : 0;
    const curve = getCourseCurve(progress + elapsed * 0.00002);
    const pulse = Math.sin(elapsed * 0.015 * (0.9 + speedRatio)) * (2.4 + speedRatio * 8);
    const targetSpeed = racing
        ? clamp(
            44 +
            (me ? me.speed * 72 : 0) +
            Math.sin(elapsed * 0.004) * 6 -
            Math.abs(curve) * 18 +
            speedRatio * 18,
            38,
            TOP_DISPLAY_SPEED
        )
        : 0;

    currentSpeedKmh = lerp(currentSpeedKmh, targetSpeed, racing ? 0.08 : 0.05);
    gaugeSpeedKmh = lerp(gaugeSpeedKmh, currentSpeedKmh, racing ? 0.18 : 0.1);

    cockpitScene.style.setProperty("--vehicle-roll", `${(curve * (1.6 + speedRatio * 2.4)).toFixed(2)}deg`);
    cockpitScene.style.setProperty("--vehicle-bounce", `${pulse.toFixed(2)}px`);
    cockpitScene.style.setProperty("--vehicle-shift", `${(curve * 16 * speedRatio).toFixed(2)}px`);
    cockpitScene.style.setProperty("--steer-angle", `${(curve * (8 + speedRatio * 18)).toFixed(2)}deg`);
    cockpitScene.style.setProperty("--streak-opacity", (currentSpeedKmh / TOP_DISPLAY_SPEED * 0.72).toFixed(2));
    cockpitScene.style.setProperty("--vibration-opacity", (0.18 + currentSpeedKmh / TOP_DISPLAY_SPEED * 0.6).toFixed(2));
}

function updateUi() {
    const leader = getLeader();
    const me = getPlayer();
    const remaining = leader
        ? Math.max(0, DISTANCE_METERS - Math.round(leader.progress * DISTANCE_METERS))
        : DISTANCE_METERS;
    const myDistance = me ? Math.round(me.progress * DISTANCE_METERS) : 0;
    const leaderId = leader ? leader.id : null;

    raceState.textContent = getRaceStateText();
    distanceLeft.textContent = `${remaining}m`;
    leaderName.textContent = leader ? leader.name : "-";
    currentSpeed.textContent = `${Math.round(currentSpeedKmh)} km/h`;
    myProgress.textContent = `${myDistance}m`;

    courseDisplay.classList.toggle("leader-me", Boolean(leader && leader.id === "me"));
    courseDisplay.classList.toggle("leader-opponent", Boolean(leader && leader.id !== "me"));
    telemetryDisplay.classList.toggle("leader-me", Boolean(leader && leader.id === "me"));
    telemetryDisplay.classList.toggle("leader-opponent", Boolean(leader && leader.id !== "me"));
    telemetryDisplay.classList.toggle("speed-hot", currentSpeedKmh >= 150);

    if (racing && lastLeaderId && leaderId && leaderId !== lastLeaderId) {
        playLeadAudio(leader);
    }

    lastLeaderId = leaderId;
}

function frame(timestamp) {
    const delta = lastFrameTime ? timestamp - lastFrameTime : 16.6667;
    lastFrameTime = timestamp;

    updateRace(delta, timestamp);
    updateMotionAndSpeed(timestamp);
    drawRaceDisplay(timestamp);
    drawGaugeDisplay(timestamp);
    updateUi();

    animationId = requestAnimationFrame(frame);
}

function ensureLoop() {
    if (!animationId) {
        animationId = requestAnimationFrame(frame);
    }
}

function startRace() {
    if (racing) {
        return;
    }

    if (winner) {
        setupRace();
    }

    syncRaceDuration();
    audioEnabled = true;
    lastLeaderId = getLeader() ? getLeader().id : null;
    racing = true;
    announcement.textContent = `${Math.round(raceDurationMs / 1000)} second race started. Vehicle motion and both round displays are now reacting together.`;
}

function boostMe() {
    const me = getPlayer();
    if (!me) {
        return;
    }

    me.speed = clamp(me.speed + BOOST_AMOUNT, SPEED_LIMITS.min, SPEED_LIMITS.max);
    announcement.textContent = `Player speed boosted to ${me.speed.toFixed(2)}x. The right gauge should react more aggressively now.`;
}

function boostOthers() {
    racers
        .filter((racer) => racer.id !== "me")
        .forEach((racer) => {
            racer.speed = clamp(racer.speed + BOOST_AMOUNT, SPEED_LIMITS.min, SPEED_LIMITS.max);
        });

    announcement.textContent = "Rival speed boosted. Expect more pressure and more close chasing moments on the left display.";
}

function slowMe() {
    const me = getPlayer();
    if (!me) {
        return;
    }

    me.speed = clamp(me.speed - BOOST_AMOUNT, SPEED_LIMITS.min, SPEED_LIMITS.max);
    announcement.textContent = `Player speed reduced to ${me.speed.toFixed(2)}x.`;
}

function slowOthers() {
    racers
        .filter((racer) => racer.id !== "me")
        .forEach((racer) => {
            racer.speed = clamp(racer.speed - BOOST_AMOUNT, SPEED_LIMITS.min, SPEED_LIMITS.max);
        });

    announcement.textContent = "Rival speed reduced. It should be easier to hold the lead now.";
}

function resetRace() {
    syncRaceDuration();
    setupRace();
    announcement.textContent = "Race reset. Press start to launch the cockpit motion and both round displays again.";
}

syncRaceDuration();
setupRace();
updateModeToggleUi();
ensureLoop();

startBtn.addEventListener("click", startRace);
boostMeBtn.addEventListener("click", boostMe);
slowMeBtn.addEventListener("click", slowMe);
boostOthersBtn.addEventListener("click", boostOthers);
slowOthersBtn.addEventListener("click", slowOthers);
resetBtn.addEventListener("click", resetRace);
raceDurationInput.addEventListener("change", syncRaceDuration);
if (modeToggleBtn) {
    modeToggleBtn.addEventListener("click", toggleRaceMode);
}
courseDisplay.addEventListener("animationend", () => {
    courseDisplay.classList.remove("overtake-boost", "overtake-hit");
});
