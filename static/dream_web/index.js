// import * as d3 from "https://cdn.skypack.dev/d3@7";


function toBase64(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.readAsDataURL(file);
        r.onload = () => resolve(r.result);
        r.onerror = (error) => reject(error);
    });
}

function appendOutput(src, seed, config) {
    let outputNode = document.createElement("figure");

    let variations = config.with_variations;
    if (config.variation_amount > 0) {
        variations = (variations ? variations + ',' : '') + seed + ':' + config.variation_amount;
    }
    let baseseed = (config.with_variations || config.variation_amount > 0) ? config.seed : seed;
    let altText = baseseed + ' | ' + (variations ? variations + ' | ' : '') + config.prompt;

    // img needs width and height for lazy loading to work
    const figureContents = `
        <a href="${src}" target="_blank">
            <img src="${src}"
                 alt="${altText}"
                 title="${altText}"
                 loading="lazy"
                 width="256"
                 height="256">
        </a>
        <figcaption>${seed}</figcaption>
    `;

    outputNode.innerHTML = figureContents;
    let figcaption = outputNode.querySelector('figcaption');

    // Reload image config
    figcaption.addEventListener('click', () => {
        let form = document.querySelector("#generate-form");
        for (const [k, v] of new FormData(form)) {
            if (k == 'initimg') { continue; }
            form.querySelector(`*[name=${k}]`).value = config[k];
        }

        document.querySelector("#seed").value = baseseed;
        document.querySelector("#with_variations").value = variations || '';
        if (document.querySelector("#variation_amount").value <= 0) {
            document.querySelector("#variation_amount").value = 0.2;
        }

        saveFields(document.querySelector("#generate-form"));
    });

    document.querySelector("#results").prepend(outputNode);
}

function saveFields(form) {
    for (const [k, v] of new FormData(form)) {
        if (typeof v !== 'object') { // Don't save 'file' type
            localStorage.setItem(k, v);
        }
    }
}

function loadFields(form) {
    for (const [k, v] of new FormData(form)) {
        const item = localStorage.getItem(k);
        if (item != null) {
            form.querySelector(`*[name=${k}]`).value = item;
        }
    }
}

function clearFields(form) {
    localStorage.clear();
    let prompt = form.prompt.value;
    form.reset();
    form.prompt.value = prompt;
}

const BLANK_IMAGE_URL = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
async function generateSubmit(form) {
    const prompt = document.querySelector("#prompt").value;

    // Convert file data to base64
    let formData = Object.fromEntries(new FormData(form));
    formData.initimg_name = formData.initimg.name
    formData.initimg = formData.initimg.name !== '' ? await toBase64(formData.initimg) : null;

    let strength = formData.strength;
    let totalSteps = formData.initimg ? Math.floor(strength * formData.steps) : formData.steps;

    let progressSectionEle = document.querySelector('#progress-section');
    progressSectionEle.style.display = 'initial';
    let progressEle = document.querySelector('#progress-bar');
    progressEle.setAttribute('max', totalSteps);
    let progressImageEle = document.querySelector('#progress-image');
    progressImageEle.src = BLANK_IMAGE_URL;

    progressImageEle.style.display = {}.hasOwnProperty.call(formData, 'progress_images') ? 'initial' : 'none';

    // Post as JSON, using Fetch streaming to get results
    fetch(form.action, {
        method: form.method,
        body: JSON.stringify(formData),
    }).then(async (response) => {
        const reader = response.body.getReader();

        let noOutputs = true;
        while (true) {
            let { value, done } = await reader.read();
            value = new TextDecoder().decode(value);
            if (done) {
                progressSectionEle.style.display = 'none';
                break;
            }

            for (let event of value.split('\n').filter(e => e !== '')) {
                const data = JSON.parse(event);

                if (data.event === 'result') {
                    noOutputs = false;
                    appendOutput(data.url, data.seed, data.config);
                    // TODO: append node to graph, add any links
                    console.log(data)
                    addNodeToGraph(graph, { ...data.config, url: data.url })
                    addLinksForNode(graph, { ...data.config, url: data.url })
                    // FIXME: update data in actual graph element

                    progressEle.setAttribute('value', 0);
                    progressEle.setAttribute('max', totalSteps);
                } else if (data.event === 'upscaling-started') {
                    document.getElementById("processing_cnt").textContent = data.processed_file_cnt;
                    document.getElementById("scaling-inprocess-message").style.display = "block";
                } else if (data.event === 'upscaling-done') {
                    document.getElementById("scaling-inprocess-message").style.display = "none";
                } else if (data.event === 'step') {
                    progressEle.setAttribute('value', data.step);
                    if (data.url) {
                        progressImageEle.src = data.url;
                    }
                } else if (data.event === 'canceled') {
                    // avoid alerting as if this were an error case
                    noOutputs = false;
                }
            }
        }

        // Re-enable form, remove no-results-message
        form.querySelector('fieldset').removeAttribute('disabled');
        document.querySelector("#prompt").value = prompt;
        document.querySelector('progress').setAttribute('value', '0');

        if (noOutputs) {
            alert("Error occurred while generating.");
        }
    });

    // Disable form while generating
    form.querySelector('fieldset').setAttribute('disabled', '');
    document.querySelector("#prompt").value = `Generating: "${prompt}"`;
}

async function fetchRunLog(graph) {
    try {
        let response = await fetch('/run_log.json')
        const data = await response.json();
        for (let item of data.run_log) {
            appendOutput(item.url, item.seed, item);
            // DONE: Add items to a graph
            // console.log(item);
            addNodeToGraph(graph, item)
        }
        // DONE: Add links between nodes
        addLinksToGraph(graph)

        console.log(graph);
    } catch (e) {
        console.error(e);
    }
}

function addNodeToGraph(graph, node) {
    graph.nodes.push(node);
}

function addLinksForNode(graph, node) {
    /* 
    for node in graph
        split node.with_variations
        get last (most recent) variation
        if this variation exists
            add a link to the graph between the current node and the node for this ancestor
        else
            if this image has a seed that is different from its own
                add a link between this node and the node with the seed
            else
                add a link to the origin (blank starting node)
                NOTE: maybe not necessary if you just want to have disjointed trees
            end
        end
    end
    */
    const variations = node.with_variations.split(",")
    const last = variations.slice(-1)[0]
    // console.log(variations, last);
    if (last != "") {
        // console.log(last);
        const [ancestor_seed, ancestor_weight] = last.split(":")
        const ancestor = getNodeBySeed(graph, ancestor_seed)

        graph.links.push({
            source: ancestor.url,
            target: node.url,
            weight: parseFloat(ancestor_weight)
        })

    } else {
        // console.log(last);
        const seed_image = getNodeBySeed(graph, node.seed)

        if (node.url != seed_image.url) {
            graph.links.push({
                source: seed_image.url,
                target: node.url,
                weight: 1.0
            })
        } else {
            // This is where you would link to the origin, since this must be an original image
            // TODO: link origin to node
        }
    }
}

function addLinksToGraph(graph) {
    for (let node of graph.nodes) {
        addLinksForNode(graph, node)
    }
}

function getNodeBySeed(graph, seed) {
    const matches = graph.nodes.filter(node => node.url.includes(seed))
    // console.log(matches);
    return matches[0]
}

// Copyright 2021 Observable, Inc.
// Released under the ISC license.
// https://observablehq.com/@d3/disjoint-force-directed-graph
function ForceGraph({
    nodes, // an iterable of node objects (typically [{id}, …])
    links // an iterable of link objects (typically [{source, target}, …])
}, {
    nodeId = d => d.id, // given d in nodes, returns a unique identifier (string)
    nodeGroup, // given d in nodes, returns an (ordinal) value for color
    nodeGroups, // an array of ordinal values representing the node groups
    nodeTitle, // given d in nodes, a title string
    nodeFill = "currentColor", // node stroke fill (if not using a group color encoding)
    nodeStroke = "#fff", // node stroke color
    nodeStrokeWidth = 1.5, // node stroke width, in pixels
    nodeStrokeOpacity = 1, // node stroke opacity
    nodeRadius = 5, // node radius, in pixels
    nodeStrength,
    linkSource = ({ source }) => source, // given d in links, returns a node identifier string
    linkTarget = ({ target }) => target, // given d in links, returns a node identifier string
    linkStroke = "#999", // link stroke color
    linkStrokeOpacity = 0.6, // link stroke opacity
    linkStrokeWidth = 1.5, // given d in links, returns a stroke width in pixels
    linkStrokeLinecap = "round", // link stroke linecap
    linkStrength,
    colors = d3.schemeTableau10, // an array of color strings, for the node groups
    width = 640, // outer width, in pixels
    height = 400, // outer height, in pixels
    invalidation // when this promise resolves, stop the simulation
} = {}) {
    // Compute values.
    const N = d3.map(nodes, nodeId).map(intern);
    const LS = d3.map(links, linkSource).map(intern);
    const LT = d3.map(links, linkTarget).map(intern);
    if (nodeTitle === undefined) nodeTitle = (_, i) => N[i];
    const T = nodeTitle == null ? null : d3.map(nodes, nodeTitle);
    const G = nodeGroup == null ? null : d3.map(nodes, nodeGroup).map(intern);
    const W = typeof linkStrokeWidth !== "function" ? null : d3.map(links, linkStrokeWidth);

    // Replace the input nodes and links with mutable objects for the simulation.
    // nodes = d3.map(nodes, (_, i) => ({ id: N[i] }));
    // FIXME: find a way to change this so that the nodes will update as new ones are added
    nodes = d3.map(nodes, (_, i) => ({ id: N[i], data: nodes[i] }));
    links = d3.map(links, (_, i) => ({ source: LS[i], target: LT[i] }));

    // Compute default domains.
    if (G && nodeGroups === undefined) nodeGroups = d3.sort(G);

    // Construct the scales.
    const color = nodeGroup == null ? null : d3.scaleOrdinal(nodeGroups, colors);

    // Construct the forces.
    const forceNode = d3.forceManyBody();
    const forceLink = d3.forceLink(links).id(({ index: i }) => N[i]);
    if (nodeStrength !== undefined) forceNode.strength(nodeStrength);
    if (linkStrength !== undefined) forceLink.strength(linkStrength);

    const simulation = d3.forceSimulation(nodes)
        .force("link", forceLink)
        .force("charge", forceNode)
        .force("x", d3.forceX())
        .force("y", d3.forceY())
        .on("tick", ticked);

    const svg = d3.create("svg")
        .attr("width", width)
        .attr("height", height)
        .attr("viewBox", [-width / 2, -height / 2, width, height])
        // .attr("align", "center")
        .attr("style", "max-width: 100%; height: auto; height: intrinsic;");

    // const link = svg.append("g")
    var link = svg.append("g")
        .attr("stroke", linkStroke)
        .attr("stroke-opacity", linkStrokeOpacity)
        .attr("stroke-width", typeof linkStrokeWidth !== "function" ? linkStrokeWidth : null)
        .attr("stroke-linecap", linkStrokeLinecap)
        .selectAll("line")
        .data(links)
        .join("line");

    if (W) link.attr("stroke-width", ({ index: i }) => W[i]);

    const tooltip = d3.select("body").append("div")
    .attr("class", "tooltip")
    .style("opacity", 0);
    
    // TODO: change the nodes to be images instead of circles
    // const node = svg.append("g")
    var node = svg.append("g")
    .attr("fill", nodeFill)
    .attr("stroke", nodeStroke)
    .attr("stroke-opacity", nodeStrokeOpacity)
    .attr("stroke-width", nodeStrokeWidth)
    .selectAll("circle")
    .data(nodes, function (d) {
        return d.url
    })
    .join("circle")
    .attr("r", nodeRadius)
    .on("mouseover", function (e, d) {
        d3.select(this).transition()
        .duration('100')
        .attr("r", 7)
        // console.log(d3.select(this));
        // e.preventDefault()
        // console.log(d)
        // console.log(e)
        // console.log(this)
        
        tooltip.transition()
        .duration(30)
        .style("opacity", 1)
        .style("left", e.pageX + "px")
        .style("top", e.pageY + "px")
        // console.log(tooltip.html())
        
        const tooltipHTML = `
        <img src="${d.data.url}"
        loading="lazy"
        width="192"
        height="192">
        <div>
        <p><strong>Prompt:</strong> ${d.data.prompt}</p>
        <p><strong>Sampler:</strong> ${d.data.steps} steps on ${d.data.sampler_name.toUpperCase()}</p>
        <p><strong>CFG:</strong> ${d.data.cfg_scale}</p>
        <p><strong>Seed:</strong> ${d.data.seed}</p>
        <p><strong>With Variations:</strong> ${d.data.with_variations}</p>
        <p><strong>File:</strong> ${d.data.url}</p>
        </div>
        `;
        
            tooltip.html(tooltipHTML)
            // console.log(tooltip.html())

        })
        .on("mouseout", function (e, d) {
            d3.select(this).transition()
                .duration('200')
                .attr("r", 5)

            // console.log(d)
            // console.log(this)
            tooltip.transition()
                .duration(200)
                .style("opacity", 0)
        })
        .call(drag(simulation))

        // node.append('svg:image')
        // .attr("xlink:href", function(d) {
        //     console.log(d);
        //     return d.data.url;
        // })
        // .attr("x", function(d) {
        //     return -25;
        // })
        // .attr("y", function(d) {
        //     return -25;
        // })
        // .attr("height", 128)
        // .attr("width", 128);


    if (G) node.attr("fill", ({ index: i }) => color(G[i]));
    // if (T) node.append("title").text(({ index: i }) => T[i]);

    // Handle invalidation.
    if (invalidation != null) invalidation.then(() => simulation.stop());

    function intern(value) {
        return value !== null && typeof value === "object" ? value.valueOf() : value;
    }

    function ticked() {
        link
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);

        node
            .attr("cx", d => d.x)
            .attr("cy", d => d.y);
    }

    function drag(simulation) {
        function dragstarted(event) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            event.subject.fx = event.subject.x;
            event.subject.fy = event.subject.y;
        }

        function dragged(event) {
            event.subject.fx = event.x;
            event.subject.fy = event.y;
        }

        function dragended(event) {
            if (!event.active) simulation.alphaTarget(0);
            event.subject.fx = null;
            event.subject.fy = null;
        }

        return d3.drag()
            .on("start", dragstarted)
            .on("drag", dragged)
            .on("end", dragended);
    }

    return Object.assign(svg.node(), { scales: { color } });
}

// Global
let graph = {
    nodes: [],
    links: []
}

window.onload = async () => {
    document.querySelector("#prompt").addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            const form = e.target.form;
            generateSubmit(form);
        }
    });
    document.querySelector("#generate-form").addEventListener('submit', (e) => {
        e.preventDefault();
        const form = e.target;

        generateSubmit(form);
    });
    document.querySelector("#generate-form").addEventListener('change', (e) => {
        saveFields(e.target.form);
    });
    document.querySelector("#reset-seed").addEventListener('click', (e) => {
        document.querySelector("#seed").value = -1;
        saveFields(e.target.form);
    });
    document.querySelector("#reset-all").addEventListener('click', (e) => {
        clearFields(e.target.form);
    });
    document.querySelector("#remove-image").addEventListener('click', (e) => {
        initimg.value = null;
    });
    loadFields(document.querySelector("#generate-form"));

    document.querySelector('#cancel-button').addEventListener('click', () => {
        fetch('/cancel').catch(e => {
            console.error(e);
        });
    });
    document.documentElement.addEventListener('keydown', (e) => {
        if (e.key === "Escape")
            fetch('/cancel').catch(err => {
                console.error(err);
            });
    });

    if (!config.gfpgan_model_exists) {
        document.querySelector("#gfpgan").style.display = 'none';
    }

    let graph_div = document.querySelector("#graph");

    // let graph = {
    //     nodes: [],
    //     links: []
    // }
    await fetchRunLog(graph)

    // To render a chart, pass ForceGraph an array of data and any desired options; 
    // it will return an SVG element that you can insert into the DOM.
    // DONE: actually put this into the DOM
    let chart = ForceGraph(graph, {
        nodeId: d => d.url,
        // nodeGroup: d => d.group,
        nodeGroup: d => d.prompt,
        // nodeTitle: d => `${d.url} (${d.group})`,
        // nodeTitle: d => [
        //     d.url,
        //     d.prompt,
        //     d.with_variations,
        // ].join('\n'),
        // width,
        height: 680,
        // invalidation // a promise to stop the simulation when the cell is re-run
    })

    graph_div.appendChild(chart);
};
