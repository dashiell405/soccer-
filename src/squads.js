// Original squads for Stadium Soccer.
// Every name is made up. Real players, clubs, and FIFA/EA names stay out
// of the game so it can be published later. A player can rename someone
// on their own device; that rename is never the default.

const SKIN = ["#ffdbac", "#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#5c3317", "#3d2314"];
const HAIR = ["#111111", "#2b1b0e", "#6b3e1e", "#d9b25f", "#b7410e", "#eeeeee", "#4a3728"];
const BOOT = ["#111111", "#f7f7f7", "#e74c3c", "#f1c40f", "#2980b9", "#27ae60", "#e67e22", "#8e44ad"];

// [num, pos, name, pace, shoot, pass, dribble, defend, stamina, gk, skin, hair, cut, tall, boot, trait, flags]
// flags: C captain, S star, CS both. trait changes how they play.
function P(num, pos, name, a, look, trait, flags) {
  return {
    num: num, pos: pos, name: name,
    pace: a[0], shoot: a[1], pass: a[2], dribble: a[3], defend: a[4], stamina: a[5], gk: a[6],
    skin: SKIN[look[0]], hair: HAIR[look[1]], cut: look[2], tall: look[3], boots: BOOT[look[4]],
    trait: trait || "",
    captain: flags === "C" || flags === "CS",
    star: flags === "S" || flags === "CS",
  };
}

const FORMATIONS = {
  "4-3-3": [
    { role: "GK", d: 0.03, l: 0 },
    { role: "DEF", d: 0.18, l: -0.72 },
    { role: "DEF", d: 0.15, l: -0.26 },
    { role: "DEF", d: 0.15, l: 0.26 },
    { role: "DEF", d: 0.18, l: 0.72 },
    { role: "MID", d: 0.34, l: 0 },
    { role: "MID", d: 0.42, l: -0.36 },
    { role: "MID", d: 0.50, l: 0.28 },
    { role: "FWD", d: 0.68, l: -0.58 },
    { role: "FWD", d: 0.74, l: 0 },
    { role: "FWD", d: 0.68, l: 0.58 },
  ],
  "4-4-2": [
    { role: "GK", d: 0.03, l: 0 },
    { role: "DEF", d: 0.18, l: -0.72 },
    { role: "DEF", d: 0.15, l: -0.26 },
    { role: "DEF", d: 0.15, l: 0.26 },
    { role: "DEF", d: 0.18, l: 0.72 },
    { role: "MID", d: 0.44, l: -0.70 },
    { role: "MID", d: 0.40, l: -0.24 },
    { role: "MID", d: 0.40, l: 0.24 },
    { role: "MID", d: 0.44, l: 0.70 },
    { role: "FWD", d: 0.70, l: -0.22 },
    { role: "FWD", d: 0.70, l: 0.22 },
  ],
  "5-4-1": [
    { role: "GK", d: 0.03, l: 0 },
    { role: "DEF", d: 0.22, l: -0.78 },
    { role: "DEF", d: 0.14, l: -0.40 },
    { role: "DEF", d: 0.12, l: 0 },
    { role: "DEF", d: 0.14, l: 0.40 },
    { role: "DEF", d: 0.22, l: 0.78 },
    { role: "MID", d: 0.40, l: -0.62 },
    { role: "MID", d: 0.36, l: -0.20 },
    { role: "MID", d: 0.36, l: 0.20 },
    { role: "MID", d: 0.40, l: 0.62 },
    { role: "FWD", d: 0.64, l: 0 },
  ],
  "4-2-3-1": [
    { role: "GK", d: 0.03, l: 0 },
    { role: "DEF", d: 0.18, l: -0.72 },
    { role: "DEF", d: 0.15, l: -0.26 },
    { role: "DEF", d: 0.15, l: 0.26 },
    { role: "DEF", d: 0.18, l: 0.72 },
    { role: "MID", d: 0.34, l: -0.22 },
    { role: "MID", d: 0.34, l: 0.22 },
    { role: "MID", d: 0.52, l: -0.55 },
    { role: "MID", d: 0.54, l: 0 },
    { role: "MID", d: 0.52, l: 0.55 },
    { role: "FWD", d: 0.74, l: 0 },
  ],
};

const TRAIT_NAME = {
  speedster: "Speedster", playmaker: "Playmaker", finisher: "Finisher",
  wall: "Wall", dribbler: "Dribbler", rock: "Rock", engine: "Engine",
};
const TRAIT_BLURB = {
  speedster: "sprints faster",
  playmaker: "passes more accurately",
  finisher: "stronger, more accurate shots",
  wall: "better goalkeeper reflexes",
  dribbler: "keeps the ball under pressure",
  rock: "wins more tackles",
  engine: "gets tired more slowly",
};
const STYLE_TEXT = {
  attack: "Fast attacking team",
  control: "Keeps the ball and builds the play",
  defend: "Sits deeper and defends",
};

const SQUADS = {
  bra: { formation: "4-3-3", style: "attack", players: [
    P(1, "GK", "Otto Vale", [52, 30, 64, 42, 48, 80, 94], [2, 0, "short", 1.08, 3], "wall", ""),
    P(6, "LB", "Caio Rocha", [82, 50, 72, 74, 74, 84, 12], [4, 1, "curly", 0.98, 5], "", ""),
    P(4, "LCB", "Ivo Campos", [68, 42, 66, 56, 90, 82, 14], [3, 0, "buzz", 1.10, 0], "rock", "C"),
    P(3, "RCB", "Raul Mendes", [66, 40, 64, 54, 86, 78, 12], [5, 1, "short", 1.06, 2], "", ""),
    P(2, "RB", "Pedro Fontoura", [80, 52, 70, 72, 76, 82, 12], [1, 2, "short", 1.00, 4], "", ""),
    P(5, "CDM", "Davi Nunes", [74, 56, 76, 68, 80, 93, 12], [4, 3, "buzz", 1.02, 6], "engine", ""),
    P(8, "CM", "Enzo Martins", [78, 70, 82, 80, 62, 84, 12], [2, 0, "curly", 0.96, 1], "", ""),
    P(14, "CAM", "Luan Pires", [82, 78, 92, 88, 48, 80, 12], [3, 1, "short", 0.94, 3], "playmaker", ""),
    P(21, "LW", "Kadu Vieira", [96, 84, 74, 90, 36, 86, 12], [6, 0, "afro", 1.00, 7], "speedster", "S"),
    P(9, "ST", "Hugo Santarem", [86, 95, 72, 82, 38, 84, 12], [1, 2, "short", 1.04, 2], "finisher", "S"),
    P(11, "RW", "Nilo Duarte", [88, 80, 76, 93, 36, 78, 12], [5, 4, "mohawk", 0.97, 5], "dribbler", ""),
  ] },
  arg: { formation: "4-3-3", style: "attack", players: [
    P(1, "GK", "Bruno Quintela", [50, 28, 66, 40, 46, 78, 90], [1, 0, "short", 1.06, 3], "wall", ""),
    P(3, "LB", "Franco Salvatierra", [80, 48, 72, 70, 74, 82, 12], [2, 2, "short", 0.98, 0], "", ""),
    P(6, "LCB", "Ivo Sosa", [66, 40, 64, 54, 91, 82, 14], [1, 1, "buzz", 1.08, 0], "rock", "C"),
    P(13, "RCB", "Nico Vidal", [64, 38, 62, 52, 84, 78, 12], [0, 3, "short", 1.04, 4], "", ""),
    P(2, "RB", "Tomas Gil", [78, 50, 68, 72, 74, 80, 12], [2, 0, "curly", 1.00, 2], "", ""),
    P(5, "CDM", "Elias Mora", [70, 52, 76, 66, 80, 91, 12], [3, 1, "short", 1.02, 6], "engine", ""),
    P(14, "CM", "Gabi Ortiz", [76, 68, 84, 78, 60, 82, 12], [1, 4, "curly", 0.95, 1], "", ""),
    P(8, "CAM", "Santi Ojeda", [84, 78, 95, 90, 44, 82, 12], [0, 2, "curly", 0.92, 3], "playmaker", "S"),
    P(16, "LW", "Ramiro Bustamante", [86, 76, 74, 84, 38, 80, 12], [4, 0, "short", 1.00, 5], "", ""),
    P(19, "ST", "Lucho Ferrer", [88, 95, 74, 86, 36, 84, 12], [2, 1, "short", 0.98, 7], "finisher", "S"),
    P(22, "RW", "Mateo Ruiz", [88, 78, 74, 92, 34, 76, 12], [5, 6, "mohawk", 0.96, 4], "dribbler", ""),
  ] },
  fra: { formation: "4-3-3", style: "attack", players: [
    P(1, "GK", "Paul Renard", [50, 28, 62, 40, 46, 78, 88], [0, 3, "short", 1.10, 3], "wall", ""),
    P(3, "LB", "Yves Martin", [82, 52, 74, 76, 72, 84, 12], [1, 0, "short", 1.00, 5], "", ""),
    P(4, "LCB", "Hugo Blanc", [68, 44, 66, 56, 88, 82, 14], [0, 1, "buzz", 1.12, 0], "rock", "C"),
    P(5, "RCB", "Theo Laurent", [66, 42, 64, 58, 84, 78, 12], [2, 2, "short", 1.06, 2], "", ""),
    P(2, "RB", "Marc Dupont", [80, 54, 72, 74, 74, 82, 12], [1, 5, "bald", 1.02, 1], "", ""),
    P(6, "CDM", "Noah Bernard", [74, 58, 80, 70, 78, 92, 12], [4, 0, "curly", 1.04, 6], "engine", ""),
    P(8, "CM", "Leo Marchand", [78, 72, 86, 80, 60, 84, 12], [0, 2, "short", 0.98, 4], "", ""),
    P(14, "CAM", "Remy Caron", [82, 76, 90, 86, 46, 80, 12], [1, 1, "curly", 0.94, 3], "playmaker", ""),
    P(20, "LW", "Adam Diallo", [96, 86, 74, 88, 34, 86, 12], [6, 0, "afro", 1.02, 7], "speedster", "S"),
    P(9, "ST", "Luc Morel", [84, 94, 72, 80, 40, 84, 12], [2, 3, "short", 1.08, 2], "finisher", "S"),
    P(11, "RW", "Malik Fontaine", [88, 80, 76, 92, 36, 80, 12], [5, 1, "short", 0.97, 5], "dribbler", ""),
  ] },
  eng: { formation: "4-2-3-1", style: "control", players: [
    P(1, "GK", "Owen Blake", [50, 30, 64, 40, 48, 80, 84], [0, 3, "short", 1.08, 3], "wall", ""),
    P(3, "LB", "Callum Briggs", [82, 52, 72, 74, 74, 86, 12], [1, 2, "short", 1.00, 4], "", ""),
    P(4, "LCB", "George Hale", [64, 40, 64, 52, 88, 82, 14], [0, 1, "buzz", 1.10, 0], "rock", "C"),
    P(5, "RCB", "Arthur Pemberton", [66, 42, 66, 54, 84, 80, 12], [2, 0, "short", 1.06, 2], "", ""),
    P(2, "RB", "Miles Ward", [84, 50, 70, 72, 76, 86, 12], [1, 5, "buzz", 1.02, 5], "", ""),
    P(6, "LDM", "Ben Cooper", [70, 55, 76, 66, 80, 92, 12], [0, 2, "short", 1.04, 6], "engine", ""),
    P(16, "RDM", "Jake Porter", [72, 60, 80, 70, 74, 84, 12], [3, 1, "curly", 1.00, 0], "", ""),
    P(11, "LW", "Eddie Shaw", [84, 74, 74, 82, 42, 82, 12], [4, 0, "short", 0.98, 7], "", ""),
    P(8, "CAM", "Alfie Quinn", [78, 78, 92, 86, 50, 84, 12], [1, 3, "curly", 0.95, 3], "playmaker", "S"),
    P(17, "RW", "Ned Harper", [86, 80, 74, 84, 40, 82, 12], [2, 4, "mohawk", 1.00, 2], "", ""),
    P(9, "ST", "Cole Prescott", [80, 92, 70, 78, 38, 84, 12], [0, 1, "short", 1.06, 2], "finisher", "S"),
  ] },
  ger: { formation: "4-2-3-1", style: "control", players: [
    P(1, "GK", "Lars Vogel", [48, 26, 66, 38, 46, 82, 90], [0, 3, "buzz", 1.12, 3], "wall", ""),
    P(3, "LB", "Tim Berger", [78, 50, 74, 70, 74, 86, 12], [1, 2, "short", 1.02, 4], "", ""),
    P(4, "LCB", "Erik Brandt", [66, 42, 70, 55, 92, 84, 14], [0, 0, "buzz", 1.10, 0], "rock", "C"),
    P(5, "RCB", "Finn Adler", [64, 40, 66, 52, 84, 80, 12], [1, 1, "short", 1.08, 2], "", ""),
    P(2, "RB", "Max Hollenbeck", [78, 52, 72, 70, 76, 84, 12], [2, 5, "bald", 1.04, 1], "", ""),
    P(6, "LDM", "Leon Vogt", [72, 58, 82, 68, 78, 93, 12], [0, 2, "short", 1.02, 6], "engine", ""),
    P(15, "RDM", "Karl Weiss", [70, 56, 78, 66, 76, 84, 12], [1, 0, "short", 1.06, 0], "", ""),
    P(11, "LW", "Sven Holt", [82, 72, 76, 80, 44, 82, 12], [3, 3, "curly", 0.98, 5], "", ""),
    P(8, "CAM", "Jonas Keller", [76, 80, 94, 84, 52, 86, 12], [0, 1, "short", 1.00, 3], "playmaker", "S"),
    P(17, "RW", "Nils Hartmann", [80, 76, 74, 82, 42, 80, 12], [2, 4, "mohawk", 1.02, 7], "", ""),
    P(9, "ST", "Mats Lind", [78, 90, 72, 76, 40, 84, 12], [1, 3, "short", 1.08, 2], "finisher", "S"),
  ] },
  esp: { formation: "4-3-3", style: "control", players: [
    P(1, "GK", "Iago Serra", [48, 28, 68, 42, 46, 78, 86], [1, 0, "short", 1.06, 3], "wall", ""),
    P(6, "LB", "Pol Ramos", [78, 50, 76, 74, 72, 84, 12], [2, 2, "curly", 0.97, 5], "", ""),
    P(4, "LCB", "Marco Pellegrin", [64, 40, 70, 56, 86, 80, 14], [1, 1, "buzz", 1.08, 0], "rock", "C"),
    P(3, "RCB", "Alex Ordonez", [62, 38, 66, 54, 82, 78, 12], [3, 0, "short", 1.04, 2], "", ""),
    P(2, "RB", "Dani Soler", [76, 48, 74, 72, 74, 82, 12], [0, 3, "short", 1.00, 4], "", ""),
    P(5, "CDM", "Unai Iturbide", [70, 54, 82, 68, 78, 90, 12], [2, 1, "short", 1.02, 6], "engine", ""),
    P(16, "CM", "Hugo Navas", [74, 66, 86, 78, 60, 84, 12], [1, 2, "curly", 0.96, 1], "", ""),
    P(8, "CAM", "Leo Prieto", [78, 74, 94, 88, 48, 82, 12], [0, 4, "curly", 0.93, 3], "playmaker", "S"),
    P(21, "LW", "Nico Alba", [84, 76, 78, 86, 40, 80, 12], [4, 0, "short", 0.98, 7], "", ""),
    P(9, "ST", "Marc Bonet", [76, 90, 74, 78, 38, 80, 12], [2, 1, "short", 1.02, 2], "finisher", "S"),
    P(11, "RW", "Pau Riera", [82, 74, 80, 90, 36, 78, 12], [5, 6, "mohawk", 0.95, 5], "dribbler", ""),
  ] },
  por: { formation: "4-3-3", style: "attack", players: [
    P(1, "GK", "Rui Nogueira", [50, 28, 64, 40, 46, 78, 86], [1, 0, "short", 1.08, 3], "wall", ""),
    P(6, "LB", "Gil Sousa", [80, 52, 74, 76, 72, 84, 12], [2, 1, "curly", 0.98, 5], "", ""),
    P(4, "LCB", "Tiago Valverde", [66, 42, 66, 54, 88, 82, 14], [3, 0, "buzz", 1.08, 0], "rock", "C"),
    P(3, "RCB", "Nuno Vale", [64, 40, 64, 52, 82, 78, 12], [1, 2, "short", 1.04, 2], "", ""),
    P(2, "RB", "Duarte Melo", [78, 50, 70, 72, 74, 82, 12], [2, 3, "short", 1.00, 4], "", ""),
    P(5, "CDM", "Bruno Leal", [72, 56, 78, 68, 78, 90, 12], [4, 1, "short", 1.02, 6], "engine", ""),
    P(8, "CM", "Vitor Braga", [76, 70, 90, 82, 56, 84, 12], [1, 0, "curly", 0.96, 3], "playmaker", "S"),
    P(14, "CAM", "Andre Coelho", [80, 74, 84, 84, 48, 80, 12], [0, 2, "short", 0.94, 1], "", ""),
    P(18, "LW", "Rafa Tavares", [88, 78, 72, 86, 36, 82, 12], [5, 0, "afro", 1.00, 7], "speedster", ""),
    P(21, "ST", "Goncalo Pires", [84, 93, 70, 80, 36, 82, 12], [2, 1, "short", 1.04, 2], "finisher", "S"),
    P(11, "RW", "Miguel Aragao", [86, 78, 74, 90, 34, 78, 12], [3, 4, "mohawk", 0.97, 5], "dribbler", ""),
  ] },
  ned: { formation: "4-3-3", style: "attack", players: [
    P(1, "GK", "Bram Visser", [52, 30, 64, 42, 48, 80, 84], [0, 3, "short", 1.12, 3], "wall", ""),
    P(6, "LB", "Daan Koop", [84, 54, 72, 76, 72, 86, 12], [1, 2, "short", 1.04, 5], "", ""),
    P(4, "LCB", "Lars de Witt", [68, 44, 68, 56, 86, 82, 14], [0, 1, "buzz", 1.10, 0], "rock", "C"),
    P(3, "RCB", "Sem Bakker", [66, 42, 66, 54, 82, 80, 12], [2, 5, "bald", 1.08, 2], "", ""),
    P(2, "RB", "Teun Smit", [82, 52, 70, 74, 74, 84, 12], [1, 0, "short", 1.02, 4], "", ""),
    P(5, "CDM", "Joris Vos", [74, 58, 78, 68, 78, 92, 12], [0, 2, "short", 1.04, 6], "engine", ""),
    P(8, "CM", "Finn Sanders", [78, 72, 86, 80, 58, 84, 12], [3, 1, "curly", 0.98, 1], "playmaker", ""),
    P(14, "CAM", "Stijn Boer", [80, 76, 84, 84, 46, 80, 12], [1, 4, "short", 0.96, 3], "", ""),
    P(11, "LW", "Milan Dekker", [94, 82, 72, 86, 34, 86, 12], [0, 3, "long", 1.02, 7], "speedster", "S"),
    P(9, "ST", "Jesse Haan", [84, 92, 70, 78, 38, 82, 12], [2, 1, "short", 1.08, 2], "finisher", "S"),
    P(17, "RW", "Luuk Peeters", [88, 78, 74, 90, 34, 80, 12], [4, 0, "curly", 0.99, 5], "dribbler", ""),
  ] },
  ita: { formation: "5-4-1", style: "defend", players: [
    P(1, "GK", "Marco Bellini", [46, 24, 62, 36, 50, 82, 95], [1, 0, "short", 1.08, 3], "wall", "S"),
    P(3, "LWB", "Luca Ferraro", [78, 52, 70, 72, 76, 84, 12], [2, 1, "short", 0.98, 5], "", ""),
    P(5, "LCB", "Enzo Ricci", [62, 36, 66, 50, 94, 84, 16], [1, 1, "buzz", 1.08, 0], "rock", "CS"),
    P(6, "CB", "Paolo Greco", [60, 34, 64, 48, 88, 80, 14], [0, 2, "bald", 1.06, 2], "", ""),
    P(15, "RCB", "Dario Conti", [62, 36, 62, 50, 86, 78, 14], [3, 0, "short", 1.04, 0], "", ""),
    P(2, "RWB", "Andrea Ferlazzo", [76, 48, 68, 70, 76, 82, 12], [2, 3, "short", 1.00, 4], "", ""),
    P(11, "LM", "Nico Esposito", [74, 62, 76, 74, 62, 80, 12], [1, 1, "curly", 0.96, 1], "", ""),
    P(4, "LCM", "Gino Bernardi", [66, 50, 74, 62, 80, 91, 12], [4, 0, "short", 1.02, 6], "engine", ""),
    P(8, "RCM", "Fabio Riva", [68, 64, 86, 74, 64, 80, 12], [0, 2, "short", 0.97, 3], "playmaker", ""),
    P(18, "RM", "Elio Santini", [74, 66, 72, 78, 52, 78, 12], [2, 4, "mohawk", 0.95, 7], "", ""),
    P(9, "ST", "Piero Natali", [72, 84, 64, 70, 36, 76, 12], [1, 1, "short", 1.02, 2], "finisher", ""),
  ] },
  jpn: { formation: "4-4-2", style: "control", players: [
    P(1, "GK", "Haru Watanabe", [54, 32, 66, 46, 52, 82, 80], [1, 0, "short", 1.00, 3], "wall", ""),
    P(3, "LB", "Kenji Sato", [80, 50, 72, 74, 70, 88, 12], [0, 1, "short", 0.96, 5], "engine", ""),
    P(4, "LCB", "Yuto Abe", [64, 40, 64, 54, 82, 82, 14], [2, 0, "buzz", 1.02, 0], "rock", "C"),
    P(5, "RCB", "Sho Matsuda", [62, 38, 62, 52, 78, 78, 12], [1, 1, "short", 1.00, 2], "", ""),
    P(2, "RB", "Riku Aoki", [88, 52, 68, 76, 70, 88, 12], [0, 2, "short", 0.98, 4], "speedster", ""),
    P(11, "LM", "Daiki Mori", [80, 68, 74, 82, 48, 82, 12], [3, 0, "curly", 0.94, 7], "", ""),
    P(6, "LCM", "Yuma Ito", [74, 70, 90, 82, 56, 86, 12], [1, 1, "short", 0.95, 3], "playmaker", "S"),
    P(8, "RCM", "Sota Kimura", [72, 64, 78, 74, 62, 84, 12], [2, 0, "buzz", 0.97, 1], "", ""),
    P(16, "RM", "Kaito Ogawa", [78, 66, 72, 80, 50, 82, 12], [0, 3, "short", 0.96, 6], "", ""),
    P(9, "LST", "Ren Hayashi", [80, 86, 68, 76, 38, 82, 12], [1, 0, "short", 1.00, 2], "finisher", "S"),
    P(18, "RST", "Haruto Mori", [84, 76, 68, 80, 36, 84, 12], [4, 1, "mohawk", 0.98, 5], "dribbler", ""),
  ] },
  usa: { formation: "4-4-2", style: "control", players: [
    P(1, "GK", "Drew Walsh", [52, 30, 62, 42, 50, 80, 78], [0, 3, "short", 1.08, 3], "wall", ""),
    P(3, "LB", "Miles Carter", [90, 54, 68, 76, 72, 88, 12], [1, 2, "short", 1.02, 4], "speedster", "S"),
    P(4, "LCB", "Grant Holley", [64, 40, 62, 52, 82, 82, 14], [2, 1, "buzz", 1.08, 0], "rock", "C"),
    P(5, "RCB", "Andre Whitlock", [66, 42, 64, 56, 78, 80, 12], [4, 0, "short", 1.06, 2], "", ""),
    P(2, "RB", "Ty Calloway", [82, 50, 66, 72, 74, 86, 12], [5, 0, "buzz", 1.04, 5], "", ""),
    P(11, "LM", "Casey Nguyen", [80, 68, 76, 82, 46, 84, 12], [1, 0, "long", 0.96, 7], "", ""),
    P(6, "LCM", "Riley Cho", [72, 64, 80, 74, 64, 86, 12], [3, 1, "curly", 0.98, 6], "engine", ""),
    P(8, "RCM", "Quinn Adler", [74, 68, 86, 78, 58, 84, 12], [0, 3, "short", 0.97, 3], "playmaker", ""),
    P(17, "RM", "Sam Ortega", [78, 70, 72, 84, 44, 82, 12], [2, 4, "mohawk", 0.96, 1], "dribbler", ""),
    P(9, "LST", "Jordan Hale", [78, 86, 66, 74, 36, 82, 12], [0, 1, "short", 1.04, 2], "finisher", "S"),
    P(18, "RST", "Avery Cole", [76, 78, 66, 74, 34, 80, 12], [6, 1, "afro", 1.00, 5], "", ""),
  ] },
  mex: { formation: "4-4-2", style: "attack", players: [
    P(1, "GK", "Rafa Solis", [52, 32, 64, 44, 50, 78, 78], [2, 0, "short", 1.02, 3], "wall", ""),
    P(3, "LB", "Leo Vargas", [82, 54, 70, 76, 70, 84, 12], [1, 1, "curly", 0.98, 5], "", ""),
    P(4, "LCB", "Hector Salas", [64, 40, 62, 52, 80, 80, 14], [3, 0, "buzz", 1.04, 0], "rock", "C"),
    P(5, "RCB", "Omar Cruz", [62, 38, 60, 50, 76, 76, 12], [2, 1, "short", 1.02, 2], "", ""),
    P(2, "RB", "Ivan Paredes", [78, 50, 66, 70, 72, 82, 12], [1, 2, "short", 1.00, 4], "", ""),
    P(11, "LM", "Tito Navarro", [88, 76, 74, 90, 40, 82, 12], [4, 0, "curly", 0.96, 7], "dribbler", "S"),
    P(6, "LCM", "Beto Morales", [74, 66, 80, 76, 62, 84, 12], [3, 1, "short", 1.00, 6], "engine", ""),
    P(8, "RCM", "Nico Palma", [74, 70, 86, 80, 54, 80, 12], [0, 3, "curly", 0.95, 3], "playmaker", ""),
    P(16, "RM", "Luis Ortega", [80, 72, 70, 82, 42, 80, 12], [2, 4, "mohawk", 0.97, 1], "", ""),
    P(9, "LST", "Carlos Mena", [82, 88, 66, 78, 34, 80, 12], [1, 0, "short", 1.02, 2], "finisher", "S"),
    P(18, "RST", "Paco Rios", [80, 80, 64, 76, 32, 78, 12], [5, 1, "short", 0.98, 5], "", ""),
  ] },
  nga: { formation: "4-3-3", style: "attack", players: [
    P(1, "GK", "Emeka Bello", [54, 30, 62, 44, 52, 80, 82], [6, 0, "buzz", 1.08, 3], "wall", ""),
    P(6, "LB", "Dayo Lawal", [84, 52, 70, 76, 70, 86, 12], [5, 0, "short", 1.02, 5], "", ""),
    P(4, "LCB", "Seyi Bassey", [66, 42, 64, 54, 84, 82, 14], [4, 1, "buzz", 1.08, 0], "rock", "C"),
    P(3, "RCB", "Obiora Anyanwu", [64, 40, 62, 52, 78, 78, 12], [6, 0, "bald", 1.06, 2], "", ""),
    P(2, "RB", "Femi Okunola", [80, 50, 68, 72, 74, 84, 12], [5, 1, "short", 1.02, 4], "", ""),
    P(5, "CDM", "Kunle Ade", [72, 56, 76, 68, 76, 92, 12], [4, 0, "short", 1.04, 6], "engine", ""),
    P(8, "CM", "Chuka Eze", [76, 68, 82, 78, 58, 84, 12], [5, 0, "curly", 0.98, 1], "", ""),
    P(14, "CAM", "Sami Okoye", [78, 72, 88, 82, 46, 82, 12], [3, 1, "short", 0.96, 3], "playmaker", ""),
    P(21, "LW", "Chidi Okonkwo", [94, 82, 72, 88, 34, 86, 12], [6, 0, "afro", 1.04, 7], "speedster", "S"),
    P(9, "ST", "Tunde Adeyemi", [84, 90, 68, 80, 36, 84, 12], [5, 1, "short", 1.06, 2], "finisher", "S"),
    P(11, "RW", "Bolu Nwosu", [88, 78, 74, 90, 34, 80, 12], [4, 0, "mohawk", 0.99, 5], "dribbler", ""),
  ] },
  kor: { formation: "4-4-2", style: "defend", players: [
    P(1, "GK", "Doyun Han", [50, 28, 64, 42, 52, 82, 82], [1, 0, "short", 1.02, 3], "wall", ""),
    P(3, "LB", "Seo Min", [76, 48, 68, 70, 76, 86, 12], [0, 1, "short", 0.97, 5], "", ""),
    P(4, "LCB", "Jun Seo", [62, 36, 64, 50, 88, 84, 16], [2, 0, "buzz", 1.06, 0], "rock", "CS"),
    P(5, "RCB", "Hojin Bae", [60, 34, 60, 48, 80, 80, 14], [1, 1, "short", 1.02, 2], "", ""),
    P(2, "RB", "Taewoo Choi", [74, 46, 66, 68, 76, 84, 12], [0, 2, "short", 1.00, 4], "", ""),
    P(11, "LM", "Sunwoo Gil", [74, 62, 74, 76, 54, 84, 12], [3, 0, "short", 0.95, 1], "", ""),
    P(6, "LCM", "Hyunwoo Nam", [68, 54, 76, 66, 74, 92, 12], [1, 0, "buzz", 0.98, 6], "engine", ""),
    P(8, "RCM", "Jiho Kang", [70, 66, 88, 76, 62, 84, 12], [2, 1, "short", 0.96, 3], "playmaker", "S"),
    P(16, "RM", "Yoon Cha", [72, 64, 70, 78, 50, 80, 12], [0, 3, "curly", 0.95, 7], "", ""),
    P(9, "LST", "Daeho Ryu", [72, 82, 64, 70, 38, 78, 12], [1, 0, "short", 1.00, 2], "finisher", ""),
    P(18, "RST", "Siwoo Lim", [74, 74, 64, 72, 36, 78, 12], [4, 1, "mohawk", 0.97, 5], "", ""),
  ] },
  blue: { formation: "4-4-2", style: "control", players: [
    P(1, "GK", "Ned Marsh", [52, 32, 62, 44, 50, 80, 78], [1, 2, "short", 1.06, 3], "wall", ""),
    P(3, "LB", "Theo Pike", [78, 50, 70, 72, 72, 84, 12], [0, 3, "short", 1.00, 4], "", ""),
    P(4, "LCB", "Owen Pike", [64, 40, 64, 52, 82, 82, 14], [2, 1, "buzz", 1.08, 0], "rock", "C"),
    P(5, "RCB", "Cal Brooks", [62, 38, 62, 50, 76, 78, 12], [3, 0, "short", 1.04, 2], "", ""),
    P(2, "RB", "Remy Cole", [76, 48, 68, 70, 74, 82, 12], [1, 5, "bald", 1.02, 5], "", ""),
    P(11, "LM", "Jo Hale", [78, 66, 74, 80, 48, 82, 12], [0, 4, "long", 0.96, 7], "", ""),
    P(6, "LCM", "Sam Wheeler", [70, 58, 76, 68, 70, 90, 12], [2, 0, "short", 1.00, 6], "engine", ""),
    P(8, "RCM", "Ari Quinn", [74, 70, 88, 80, 56, 84, 12], [1, 3, "curly", 0.95, 3], "playmaker", "S"),
    P(17, "RM", "Noa Blake", [76, 68, 72, 84, 46, 80, 12], [4, 1, "mohawk", 0.97, 1], "dribbler", ""),
    P(9, "LST", "Kit Marlow", [76, 86, 66, 74, 36, 80, 12], [0, 2, "short", 1.02, 2], "finisher", "S"),
    P(18, "RST", "Idris Cole", [78, 76, 64, 76, 34, 78, 12], [5, 0, "afro", 1.04, 5], "", ""),
  ] },
  red: { formation: "4-3-3", style: "attack", players: [
    P(1, "GK", "Rio Blaze", [54, 32, 60, 44, 50, 80, 78], [2, 4, "mohawk", 1.04, 3], "wall", ""),
    P(6, "LB", "Ace Calder", [82, 54, 68, 76, 70, 84, 12], [1, 0, "short", 1.00, 5], "", ""),
    P(4, "LCB", "Bo Lane", [66, 42, 62, 54, 80, 80, 14], [3, 1, "buzz", 1.06, 0], "rock", "C"),
    P(3, "RCB", "Jett Rowe", [64, 40, 60, 52, 76, 78, 12], [0, 5, "bald", 1.08, 2], "", ""),
    P(2, "RB", "Kip Dunn", [78, 50, 66, 72, 72, 82, 12], [2, 2, "short", 1.00, 4], "", ""),
    P(5, "CDM", "Mac Shaw", [72, 56, 74, 68, 74, 90, 12], [4, 0, "short", 1.02, 6], "engine", ""),
    P(8, "CM", "Nico Shaw", [76, 68, 80, 78, 58, 82, 12], [1, 3, "curly", 0.98, 1], "", ""),
    P(14, "CAM", "Zig Marlow", [78, 74, 86, 84, 46, 80, 12], [5, 0, "afro", 0.96, 3], "playmaker", ""),
    P(11, "LW", "Rex Calder", [92, 82, 70, 86, 34, 84, 12], [2, 4, "mohawk", 1.02, 7], "speedster", "S"),
    P(9, "ST", "Nico Blaze", [82, 90, 68, 80, 36, 82, 12], [6, 1, "short", 1.04, 2], "finisher", "S"),
    P(17, "RW", "Pip Vega", [86, 76, 72, 90, 34, 78, 12], [0, 3, "long", 0.94, 5], "dribbler", ""),
  ] },
};

function customSquad(meta) {
  const last = String((meta && meta.name) || "Custom").replace(/[<>]/g, "").trim().slice(0, 12) || "Custom";
  const first = ["Alex", "Sam", "Jordan", "Casey", "Riley", "Morgan", "Jamie", "Quinn", "Avery", "Drew", "Sky"];
  const pos = ["GK", "LB", "LCB", "RCB", "RB", "LM", "LCM", "RCM", "RM", "LST", "RST"];
  const nums = [1, 3, 4, 5, 2, 11, 6, 8, 7, 9, 18];
  const stats = [
    [52, 30, 60, 40, 48, 76, 74],
    [72, 48, 64, 66, 70, 78, 12],
    [62, 40, 60, 50, 76, 76, 14],
    [60, 38, 58, 48, 74, 74, 12],
    [72, 46, 62, 66, 70, 78, 12],
    [74, 60, 70, 74, 48, 78, 12],
    [68, 58, 78, 70, 60, 82, 12],
    [70, 62, 74, 72, 58, 78, 12],
    [74, 64, 68, 76, 46, 76, 12],
    [74, 78, 62, 70, 34, 76, 12],
    [72, 72, 60, 70, 32, 74, 12],
  ];
  const players = pos.map((p, i) => P(
    nums[i], p, first[i] + " " + last, stats[i],
    [i % SKIN.length, (i * 2) % HAIR.length, ["short", "curly", "buzz", "afro", "long", "bald", "mohawk"][i % 7], 0.94 + (i % 5) * 0.03, i % BOOT.length],
    i === 0 ? "wall" : i === 2 ? "rock" : i === 6 ? "playmaker" : i === 9 ? "finisher" : "",
    i === 2 ? "C" : i === 9 ? "S" : ""
  ));
  return { formation: "4-4-2", style: "control", players: players };
}

function squadById(id, meta) {
  if (id && SQUADS[id]) return SQUADS[id];
  return customSquad(meta || { name: "My Team" });
}

function escHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Device-only "play as me". This is not written into the squad list.
// To take it out later, set on to false here (or delete this block).
const PLAY_AS_ME_DEFAULT = { on: true, name: "Dashiell Green" };
const PLAY_AS_ME_NUM = 10;

function loadPlayAsMe() {
  const fallback = PLAY_AS_ME_DEFAULT;
  let saved = null;
  try {
    if (typeof localStorage !== "undefined") saved = JSON.parse(localStorage.getItem("soccerPlayAsMe") || "null");
  } catch (e) { saved = null; }
  const on = saved && typeof saved.on === "boolean" ? saved.on : fallback.on;
  let name = saved && typeof saved.name === "string" ? saved.name : fallback.name;
  name = String(name).replace(/[<>]/g, "").trim().slice(0, 18);
  if (!name) name = fallback.name;
  return { on: !!on, name: name };
}

function savePlayAsMe(next) {
  const cur = loadPlayAsMe();
  const on = next && typeof next.on === "boolean" ? next.on : cur.on;
  let name = next && typeof next.name === "string" ? next.name : cur.name;
  name = String(name).replace(/[<>]/g, "").trim().slice(0, 18) || PLAY_AS_ME_DEFAULT.name;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem("soccerPlayAsMe", JSON.stringify({ on: !!on, name: name }));
  } catch (e) { /* ignore */ }
  return { on: !!on, name: name };
}

// The outfield player he replaces: shirt 10, or the attacking midfielder / playmaker.
function mePlayerIndex(players) {
  if (!players || !players.length) return -1;
  let i = players.findIndex((p) => p && p.num === PLAY_AS_ME_NUM && p.pos !== "GK");
  if (i >= 0) return i;
  i = players.findIndex((p) => p && p.pos === "CAM");
  if (i >= 0) return i;
  i = players.findIndex((p) => p && p.trait === "playmaker" && p.pos !== "GK");
  return i;
}

// A copy of the squad with one outfield player wearing his name and number 10.
// Stats, position and trait stay with that slot so the team stays balanced.
function withPlayAsMe(squad) {
  const me = loadPlayAsMe();
  if (!me.on || !squad || !squad.players) return squad;
  const players = squad.players.map((p) => Object.assign({}, p));
  const i = mePlayerIndex(players);
  if (i < 0) return squad;
  const old = players[i];
  players[i] = Object.assign({}, old, { name: me.name, num: PLAY_AS_ME_NUM, star: true, me: true });
  return Object.assign({}, squad, { players: players });
}

function loadRenames() {
  try {
    const raw = JSON.parse(localStorage.getItem("soccerRenames") || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch (e) { return {}; }
}
function renameFor(teamId, num) {
  const map = loadRenames();
  const n = map[teamId + ":" + num];
  return typeof n === "string" ? n : "";
}

function statBits(p) {
  const rows = p.pos === "GK"
    ? [["Pace", p.pace], ["Passing", p.pass], ["Keeping", p.gk], ["Stamina", p.stamina]]
    : [["Pace", p.pace], ["Shooting", p.shoot], ["Passing", p.pass], ["Dribbling", p.dribble], ["Defending", p.defend], ["Stamina", p.stamina]];
  return rows.map((row) => {
    const n = Math.max(1, Math.min(99, row[1] | 0));
    return "<div class='stat'><span>" + row[0] + "</span><i><b style='width:" + n + "%'></b></i><em>" + n + "</em></div>";
  }).join("");
}

function squadCardHtml(teamId) {
  const meta = (typeof findTeam === "function" && findTeam(teamId)) || { id: teamId || "custom", name: "My Team", rating: 3 };
  let sq = squadById(meta.id, meta);
  if (loadPlayAsMe().on) sq = withPlayAsMe(sq);
  const head = "<div class='sqhead'><b>" + escHtml(sq.formation) + "</b> · " + escHtml(STYLE_TEXT[sq.style] || "") +
    " · " + "\u2605".repeat(meta.rating || 3) + "</div>";
  const rows = sq.players.map((p) => {
    const priv = p.me ? "" : renameFor(meta.id, p.num);
    const shown = priv || p.name;
    const trait = p.trait ? "<div class='trait'>" + escHtml(TRAIT_NAME[p.trait] || p.trait) + " · " + escHtml(TRAIT_BLURB[p.trait] || "") + "</div>" : "";
    const note = priv && !p.me ? "<div class='official'>Team list: " + escHtml(p.name) + "</div>" : "";
    const rename = p.me ? "" : "<button type='button' class='renameBtn' data-rename='" + p.num + "' data-name='" + escHtml(p.name) + "'>Rename</button>";
    return "<div class='sqrow" + (p.me ? " me" : "") + "'>" +
      "<div class='who'><span class='pos'>" + escHtml(p.pos) + "</span> " +
      "<b>" + (p.star ? "<span class='star'>\u2605</span> " : "") + escHtml(shown) + "</b> " +
      "<span class='num'>#" + p.num + (p.captain ? " C" : "") + "</span>" +
      note + trait +
      rename + "</div>" +
      "<div class='bars'>" + statBits(p) + "</div></div>";
  }).join("");
  return head + rows;
}

function goalScorersHtml(stats) {
  const list = (stats && stats.scorers) || [];
  if (!list.length) return "<div class='scorers empty'>No goals</div>";
  return "<div class='scorers'><div class='label'>Goal scorers</div>" + list.map((g) =>
    "<div class='scline'><b>" + escHtml(g.name) + "</b><span>#" + g.num + (g.og ? " own goal" : "") + "</span></div>"
  ).join("") + "</div>";
}

function paintSquad() {
  const sel = document.getElementById("squadTeam");
  const list = document.getElementById("squadList");
  if (!sel || !list) return;
  list.innerHTML = squadCardHtml(sel.value);
}

function openSquadScreen() {
  const screen = document.getElementById("squadScreen");
  const sel = document.getElementById("squadTeam");
  if (!screen || !sel || typeof TEAM_LIST === "undefined") return;
  if (!sel.options.length) {
    sel.innerHTML = TEAM_LIST.map((t) => "<option value='" + t.id + "'>" + escHtml(t.name) + "</option>").join("");
  }
  try {
    if (typeof settings !== "undefined" && settings.blue && SQUADS[settings.blue]) sel.value = settings.blue;
  } catch (e) { /* ignore */ }
  const box = document.getElementById("squadRename");
  if (box) box.classList.add("hidden");
  paintPlayAsMe();
  paintSquad();
  screen.classList.remove("hidden");
}

function paintPlayAsMe() {
  const me = loadPlayAsMe();
  const on = document.getElementById("playAsMeOn");
  const name = document.getElementById("playAsMeName");
  if (on) on.checked = me.on;
  if (name && document.activeElement !== name) name.value = me.name;
}

function bindSquadScreen() {
  if (typeof document === "undefined") return;
  const screen = document.getElementById("squadScreen");
  if (!screen || screen._bound) return;
  screen._bound = true;
  document.querySelectorAll(".js-squad-open").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.preventDefault(); openSquadScreen(); });
  });
  const back = document.getElementById("squadBack");
  if (back) back.addEventListener("click", () => screen.classList.add("hidden"));
  const sel = document.getElementById("squadTeam");
  if (sel) sel.addEventListener("change", () => {
    const box = document.getElementById("squadRename");
    if (box) box.classList.add("hidden");
    paintSquad();
  });
  const list = document.getElementById("squadList");
  if (list) list.addEventListener("click", (e) => {
    const btn = e.target.closest && e.target.closest("[data-rename]");
    if (!btn) return;
    const box = document.getElementById("squadRename");
    const input = document.getElementById("squadRenameInput");
    if (!box || !input || !sel) return;
    box.dataset.team = sel.value;
    box.dataset.num = btn.getAttribute("data-rename");
    box.dataset.official = btn.getAttribute("data-name") || "";
    const priv = renameFor(sel.value, box.dataset.num);
    input.value = priv || box.dataset.official;
    box.classList.remove("hidden");
    input.focus();
    try { input.select(); } catch (err) { /* ignore */ }
  });
  const save = document.getElementById("squadRenameSave");
  if (save) save.addEventListener("click", () => {
    const box = document.getElementById("squadRename");
    const input = document.getElementById("squadRenameInput");
    if (!box || !input) return;
    const key = box.dataset.team + ":" + box.dataset.num;
    const map = loadRenames();
    const name = input.value.replace(/[<>]/g, "").trim().slice(0, 18);
    if (!name || name === box.dataset.official) delete map[key];
    else map[key] = name;
    try { localStorage.setItem("soccerRenames", JSON.stringify(map)); } catch (e) { /* ignore */ }
    box.classList.add("hidden");
    paintSquad();
  });
  const playOn = document.getElementById("playAsMeOn");
  const playName = document.getElementById("playAsMeName");
  if (playOn) playOn.addEventListener("change", () => {
    savePlayAsMe({ on: playOn.checked, name: playName ? playName.value : "" });
    paintSquad();
  });
  if (playName) playName.addEventListener("input", () => {
    savePlayAsMe({ on: playOn ? playOn.checked : true, name: playName.value });
    paintSquad();
  });
  const clear = document.getElementById("squadRenameClear");
  if (clear) clear.addEventListener("click", () => {
    const box = document.getElementById("squadRename");
    if (!box) return;
    const map = loadRenames();
    delete map[box.dataset.team + ":" + box.dataset.num];
    try { localStorage.setItem("soccerRenames", JSON.stringify(map)); } catch (e) { /* ignore */ }
    box.classList.add("hidden");
    paintSquad();
  });
}

(function checkSquads() {
  const banned = /messi|ronaldo|neymar|mbapp|haaland|maradona|zidane|pel[eé]|beckham|salah|modric|lewandowski|iniesta|benzema|griezmann|vinicius|rodrygo|mbappé|kant[eé]/i;
  const ids = Object.keys(SQUADS);
  if (ids.length < 16) throw new Error("expected every team squad");
  ids.forEach((id) => {
    const s = SQUADS[id];
    if (!FORMATIONS[s.formation]) throw new Error("bad formation " + id);
    if (!s.players || s.players.length !== 11) throw new Error("squad size " + id);
    const nums = {};
    let stars = 0;
    s.players.forEach((p) => {
      if (nums[p.num]) throw new Error("dup number " + id + " " + p.num);
      nums[p.num] = 1;
      if (!p.name || banned.test(p.name)) throw new Error("bad name " + id + " " + p.name);
      if (p.star) stars++;
    });
    if (stars < 1) throw new Error("no star " + id);
  });
})();

bindSquadScreen();
