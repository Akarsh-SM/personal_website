document.addEventListener('DOMContentLoaded', () => {
    initCircuitCanvas();
    initPCBFlow();
    initScrollCircuit();
});

function initCircuitCanvas() {
    const canvas = document.getElementById('circuit-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let width = canvas.width = canvas.offsetWidth;
    let height = canvas.height = canvas.offsetHeight;

    // Handle resizing
    window.addEventListener('resize', () => {
        if (!canvas) return;
        width = canvas.width = canvas.offsetWidth;
        height = canvas.height = canvas.offsetHeight;
        generateNetwork();
    });

    // Track mouse
    const mouse = { x: null, y: null, radius: 80 };
    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        mouse.x = e.clientX - rect.left;
        mouse.y = e.clientY - rect.top;
    });

    canvas.addEventListener('mouseleave', () => {
        mouse.x = null;
        mouse.y = null;
    });

    // Circuit Layout Configuration
    let nodes = [];
    let traces = [];
    let pulses = [];

    class Node {
        constructor(x, y, type = 'via', label = '') {
            this.x = x;
            this.y = y;
            this.type = type; // 'via', 'pad', 'mcu', 'terminal'
            this.label = label;
            this.size = type === 'mcu' ? 40 : (type === 'terminal' ? 6 : 3);
            this.pulseCooldown = 0;
        }

        draw() {
            ctx.beginPath();
            if (this.type === 'mcu') {
                // Draw MCU Chip
                ctx.fillStyle = '#1e2429';
                ctx.strokeStyle = '#2EB872';
                ctx.lineWidth = 2;
                ctx.rect(this.x - this.size, this.y - this.size, this.size * 2, this.size * 2);
                ctx.fill();
                ctx.stroke();

                // Draw pins around MCU
                ctx.fillStyle = '#a3a9b0';
                const pinCount = 6;
                const pinSpacing = (this.size * 2) / (pinCount + 1);
                
                // Top & Bottom pins
                for (let i = 1; i <= pinCount; i++) {
                    const offset = -this.size + i * pinSpacing;
                    ctx.fillRect(this.x + offset - 1, this.y - this.size - 4, 2, 4);
                    ctx.fillRect(this.x + offset - 1, this.y + this.size, 2, 4);
                    ctx.fillRect(this.x - this.size - 4, this.y + offset - 1, 4, 2);
                    ctx.fillRect(this.x + this.size, this.y + offset - 1, 4, 2);
                }
            } else {
                // Vias & Pads
                ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                ctx.fillStyle = this.type === 'pad' ? '#2EB872' : 'rgba(46, 184, 114, 0.4)';
                ctx.fill();
                if (this.type === 'pad') {
                    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            }
        }
    }

    class Trace {
        constructor(points, color = 'rgba(46, 184, 114, 0.15)', width = 1.5) {
            this.points = points; // Array of points {x, y}
            this.color = color;
            this.width = width;
        }

        draw() {
            if (this.points.length < 2) return;
            ctx.beginPath();
            ctx.moveTo(this.points[0].x, this.points[0].y);
            for (let i = 1; i < this.points.length; i++) {
                ctx.lineTo(this.points[i].x, this.points[i].y);
            }
            ctx.strokeStyle = this.color;
            ctx.lineWidth = this.width;
            ctx.stroke();
        }
    }

    class Pulse {
        constructor(trace, speed = 2, size = 3) {
            this.trace = trace;
            this.speed = speed;
            this.size = size;
            this.currentSegment = 0;
            this.progress = 0; // 0 to 1 along current segment
            this.x = trace.points[0].x;
            this.y = trace.points[0].y;
            this.active = true;
            this.color = '#2EB872';
        }

        update() {
            if (!this.active) return;

            const p1 = this.trace.points[this.currentSegment];
            const p2 = this.trace.points[this.currentSegment + 1];

            if (!p1 || !p2) {
                this.active = false;
                return;
            }

            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const distance = Math.hypot(dx, dy);
            const step = this.speed / distance;

            this.progress += step;

            if (this.progress >= 1) {
                this.currentSegment++;
                this.progress = 0;
                if (this.currentSegment >= this.trace.points.length - 1) {
                    this.active = false;
                    // Trigger flash at target node
                    triggerNodeFlash(p2.x, p2.y);
                }
            } else {
                this.x = p1.x + dx * this.progress;
                this.y = p1.y + dy * this.progress;
            }
        }

        draw() {
            if (!this.active) return;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fillStyle = this.color;
            
            // Neon glow
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#2EB872';
            ctx.fill();
            ctx.shadowBlur = 0; // Reset shadow for other drawings
        }
    }

    let flashEffects = [];
    function triggerNodeFlash(x, y) {
        flashEffects.push({
            x, y,
            radius: 2,
            maxRadius: 10,
            opacity: 1,
            speed: 0.4
        });
    }

    function generateNetwork() {
        nodes = [];
        traces = [];
        pulses = [];

        const mcuX = width * 0.5;
        const mcuY = height * 0.5;

        // Create Central MCU Node
        const mcuNode = new Node(mcuX, mcuY, 'mcu', 'MCU');
        nodes.push(mcuNode);

        // Generate peripheral nodes and trace lanes
        const pathsCount = 12;
        for (let i = 0; i < pathsCount; i++) {
            const angle = (i / pathsCount) * Math.PI * 2;
            const radius = Math.min(width, height) * 0.4;
            
            // Start terminal points (near edges)
            const startX = mcuX + Math.cos(angle) * (radius + Math.random() * 50);
            const startY = mcuY + Math.sin(angle) * (radius + Math.random() * 50);

            // Intermediate knee routing point (for clean 45/90 degree traces)
            let midX, midY;
            if (Math.abs(Math.cos(angle)) > Math.abs(Math.sin(angle))) {
                midX = mcuX + Math.cos(angle) * (radius * 0.5);
                midY = startY;
            } else {
                midX = startX;
                midY = mcuY + Math.sin(angle) * (radius * 0.5);
            }

            // Target connection point close to MCU
            const endX = mcuX + Math.cos(angle) * 45;
            const endY = mcuY + Math.sin(angle) * 45;

            const startNode = new Node(startX, startY, 'terminal');
            const midNode = new Node(midX, midY, 'via');
            const endNode = new Node(endX, endY, 'pad');

            nodes.push(startNode, midNode, endNode);

            // Create main traces connecting MCU
            const points = [
                { x: startX, y: startY },
                { x: midX, y: midY },
                { x: endX, y: endY }
            ];
            traces.push(new Trace(points));

            // Cross connectors
            if (i % 3 === 0 && i > 0) {
                const prevAngle = ((i - 1) / pathsCount) * Math.PI * 2;
                const prevStartX = mcuX + Math.cos(prevAngle) * (radius * 0.5);
                const prevStartY = mcuY + Math.sin(prevAngle) * (radius * 0.5);
                traces.push(new Trace([
                    { x: midX, y: midY },
                    { x: prevStartX, y: prevStartY }
                ], 'rgba(46, 184, 114, 0.08)', 1));
            }
        }
    }

    // Initialize network
    generateNetwork();

    // Spawn pulses periodically
    setInterval(() => {
        if (traces.length === 0) return;
        // Periodic trace pulse
        const randomTrace = traces[Math.floor(Math.random() * traces.length)];
        pulses.push(new Pulse(randomTrace, 1.2 + Math.random() * 1.5));
    }, 400);

    // Main animation loop
    function animate() {
        ctx.clearRect(0, 0, width, height);

        // Draw traces
        traces.forEach(trace => trace.draw());

        // Draw nodes
        nodes.forEach(node => {
            node.draw();
            
            // Mouse interaction: spawn pulses if mouse is near a node
            if (mouse.x && mouse.y && node.type !== 'mcu') {
                const dist = Math.hypot(node.x - mouse.x, node.y - mouse.y);
                if (dist < mouse.radius && Math.random() < 0.05) {
                    // Find a trace starting or containing this node
                    const matchingTraces = traces.filter(t => 
                        Math.hypot(t.points[0].x - node.x, t.points[0].y - node.y) < 5
                    );
                    if (matchingTraces.length > 0) {
                        const t = matchingTraces[Math.floor(Math.random() * matchingTraces.length)];
                        pulses.push(new Pulse(t, 2.5, 3.5));
                    }
                }
            }
        });

        // Update and draw pulses
        pulses = pulses.filter(p => p.active);
        pulses.forEach(pulse => {
            pulse.update();
            pulse.draw();
        });

        // Render flash effects
        ctx.save();
        flashEffects.forEach((f, idx) => {
            ctx.beginPath();
            ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(46, 184, 114, ${f.opacity})`;
            ctx.lineWidth = 1.5;
            ctx.stroke();

            f.radius += f.speed;
            f.opacity -= 0.05;

            if (f.opacity <= 0) {
                flashEffects.splice(idx, 1);
            }
        });
        ctx.restore();

        requestAnimationFrame(animate);
    }
    animate();
}

function initPCBFlow() {
    const blocks = document.querySelectorAll('.pcb-block');
    const infoTitle = document.getElementById('pcb-info-title');
    const infoText = document.getElementById('pcb-info-text');
    const pulseLines = document.querySelectorAll('.pcb-svg-lines path.pulse-line');

    if (!blocks || !infoTitle || !infoText) return;

    const details = {
        'pcb-sensors': {
            title: 'Analog & Digital Sensor Interface',
            text: 'I specialize in interfacing with high-accuracy industrial sensors. This involves configuring analog-to-digital converters (ADC) and low-noise operational amplifiers, along with robust serial buses (I2C, SPI) to pull real-time telemetry like voltage, current, power factor, and ambient temperatures.'
        },
        'pcb-mcu': {
            title: 'Embedded STM32 / ESP32 Core Processing',
            text: 'The firmware heart. Utilizes FreeRTOS for task scheduling, preemptive interrupt service routines (ISR), hardware DMA (Direct Memory Access) transfers to offload CPU load, and optimized energy algorithms ensuring sub-microsecond processing latencies.'
        },
        'pcb-memory': {
            title: 'Flash / EEPROM Logging & Data Integrity',
            text: 'Ensures data persistence during power outages. Implements wear-leveling algorithms on SPI Flash, circular ring buffers in SRAM, CRC checksum validation, and safe-recovery protocols to prevent data corruption.'
        },
        'pcb-wireless': {
            title: 'Industrial Gateway & Radio Transceivers',
            text: 'Pipes local telemetry to the cloud. Implements MQTT/TCP stacks over cellular LTE, custom energy-optimized BLE profiles for local diagnostics, Thread/Matter mesh networking, and secure OTA firmware update routines.'
        }
    };

    blocks.forEach(block => {
        block.addEventListener('mouseenter', () => {
            const id = block.id;
            if (details[id]) {
                // Highlight active block
                blocks.forEach(b => b.classList.remove('active'));
                block.classList.add('active');

                // Update text
                infoTitle.textContent = details[id].title;
                infoText.textContent = details[id].text;

                // Speed up SVG pulses when active
                pulseLines.forEach(line => {
                    line.style.animationDuration = '0.5s';
                });
            }
        });

        block.addEventListener('mouseleave', () => {
            pulseLines.forEach(line => {
                line.style.animationDuration = '1.2s';
            });
        });
    });
}

function initScrollCircuit() {
    const wrapper = document.getElementById('page-wrapper');
    const svg = document.getElementById('scroll-circuit-svg');
    const bgPath = document.getElementById('scroll-circuit-path-bg');
    const activePath = document.getElementById('scroll-circuit-path-active');

    if (!wrapper || !svg || !bgPath || !activePath) return;

    // Define sections to tap into
    const sectionIds = [
        'about-section',
        'pcb-section',
        'skills-section',
        'projects-section',
        'experience-section'
    ];

    let viasData = [];

    function setupCircuit() {
        // Clear existing via nodes
        document.querySelectorAll('.scroll-via-node').forEach(node => node.remove());
        viasData = [];

        const wrapperRect = wrapper.getBoundingClientRect();
        const wrapperTop = window.scrollY + wrapperRect.top;

        // Trunk trace starts at X=30, goes straight down the page
        const trunkX = 30;
        const tapX = 70;
        let pathD = `M ${trunkX},0`;

        sectionIds.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;

            // Find section header or display title
            const header = el.querySelector('h1, h2, .section-title, p.text-primary');
            if (!header) return;

            header.classList.add('glow-header');

            const headerRect = header.getBoundingClientRect();
            const headerY = window.scrollY + headerRect.top - wrapperTop + (headerRect.height / 2);

            // Append knee routing path to tap the header
            pathD += ` L ${trunkX},${headerY - 20}`;
            pathD += ` L ${trunkX + 20},${headerY - 10}`;
            pathD += ` L ${tapX},${headerY}`;
            pathD += ` L ${trunkX + 20},${headerY + 10}`;
            pathD += ` L ${trunkX},${headerY + 20}`;

            // Create via node element in DOM
            const via = document.createElement('div');
            via.className = 'scroll-via-node';
            // Coordinate mapping (needs to align with the SVG position on the left margin)
            // Left matches CSS: calc(50% - 635px) + tapX px
            via.style.left = `calc(50% - 635px + ${tapX}px)`;
            via.style.top = `${headerY}px`;
            wrapper.appendChild(via);

            viasData.push({
                yThreshold: headerY,
                viaElement: via,
                headerElement: header
            });
        });

        // Terminate at bottom
        pathD += ` L ${trunkX},${wrapper.offsetHeight}`;

        // Set path content
        bgPath.setAttribute('d', pathD);
        activePath.setAttribute('d', pathD);

        // Configure path drawing offsets
        const pathLength = activePath.getTotalLength();
        activePath.style.strokeDasharray = pathLength;
        activePath.style.strokeDashoffset = pathLength;

        // Cache length to utilize on scroll
        activePath.dataset.length = pathLength;
    }

    // Set up initially
    setTimeout(setupCircuit, 300); // Small timeout to ensure DOM metrics are resolved

    // Handle resizing
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(setupCircuit, 200);
    });

    // Handle scroll depth tracing
    window.addEventListener('scroll', () => {
        const pathLength = parseFloat(activePath.dataset.length);
        if (!pathLength) return;

        const wrapperRect = wrapper.getBoundingClientRect();
        const wrapperTop = window.scrollY + wrapperRect.top;
        const currentScrollY = window.scrollY;
        
        // Scroll progress percent relative to the wrapper height
        const viewportHeight = window.innerHeight;
        const totalHeight = wrapper.offsetHeight;
        
        // Compute active trace length depending on current screen scroll position
        const relativeScrollPos = currentScrollY + (viewportHeight * 0.4) - wrapperTop;
        const scrollPercent = Math.max(0, Math.min(1, relativeScrollPos / totalHeight));

        activePath.style.strokeDashoffset = pathLength - (scrollPercent * pathLength);

        // Check node activations
        viasData.forEach(node => {
            const isPassed = (currentScrollY + viewportHeight * 0.4) >= (wrapperTop + node.yThreshold);
            if (isPassed) {
                node.viaElement.classList.add('active');
                node.headerElement.classList.add('active');
            } else {
                node.viaElement.classList.remove('active');
                node.headerElement.classList.remove('active');
            }
        });
    });
}
