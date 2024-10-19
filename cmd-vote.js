import BasePlugin from "./base-plugin.js";
import y18n from "y18n";

const LOG_LEVEL = 3;
const [TEAM_ONE_ID, TEAM_TWO_ID] = [1, 2];

export default class CMDVote extends BasePlugin {
  static get description() {
    return "Voting for the demotion of the squad commander. It is started by the commander of the side";
  }

  static get defaultEnabled() {
    return false;
  }

  static get optionsSpecification() {
    return {
      language: {
        required: false,
        description: "Plugin language",
        default: "en",
      },
      startVoteCommand: {
        required: false,
        description:
          "The command for started voting for the squad leaders kick",
        default: "cmdvote",
      },
      ignoreChats: {
        required: false,
        description: "Skipped Chats",
        default: ["ChatSquad", "ChatAdmin"],
      },
      endVoteTimeout: {
        required: false,
        description: "Time to vote in seconds",
        default: 45,
      },
      timeoutAfterNewMap: {
        required: false,
        description:
          "Time after start a new match when the command is unavailable",
        default: 300,
      },
      minSquadSizeForVote: {
        required: false,
        description: "The minimum size of a squad for the vote count",
        default: 3,
      },
      minSquadsForStart: {
        required: false,
        description:
          "The minimum count of squads per side after which the command is active",
        default: 3,
      },
      minSquadsVotePercent: {
        required: false,
        description:
          "The minimum percentage of those who voted in order for the voting results to be valid, fractional value",
        default: 0.4,
      },
      periodicallyMessageTimeout: {
        required: false,
        description:
          "The time between messages about the voting process, in seconds",
        default: 6,
      },
      timeoutBetweenVote: {
        required: false,
        description: "The timeout between votes in seconds",
        default: 15,
      },
      blockCreateSquadAfterDemote: {
        required: false,
        description:
          "Should the demoted player be blocked from creating a squad until the end of the current map",
        default: true,
      },
    };
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);

    this.locale = y18n({
      locale: this.options.language,
      directory: "./squad-server/plugins/cmd-vote-locales",
    }).__;

    this.votes = new Map([
      [TEAM_ONE_ID, new Vote(TEAM_ONE_ID, this.server, this.options)],
      [TEAM_TWO_ID, new Vote(TEAM_TWO_ID, this.server, this.options)],
    ]);

    this.timeStartLastGame = 0;

    this.onStartVoteCommand = this.onStartVoteCommand.bind(this);
  }

  async onStartVoteCommand(data) {
    this.verbose(LOG_LEVEL, this.locale`Message received`, data);
    if (
      Date.now() <
      this.timeStartLastGame + this.options.timeoutAfterNewMap * 1000
    ) {
      await this.server.rcon.warn(
        data.steamID,
        this
          .locale`Voting is available ${this.options.timeoutAfterNewMap} seconds after the game starts`
      );
      return;
    }

    if (data.message) {
      const vote = this.votes.get(data.player.teamID);
      this.verbose(LOG_LEVEL, this.locale`Voting to message`, vote);
      if (vote) {
        this.verbose(
          LOG_LEVEL,
          this
            .locale`Voting object found. Start voting for the demote of the squad leader`
        );
        await vote.start(data);
      } else {
        this.verbose(LOG_LEVEL, this.locale`Voting object not found`);
        await this.server.rcon.warn(
          data.player.steamID,
          this.locale`Your team ID was not found, please try again later`
        );
      }
    }
  }

  async mount() {
    // Если во время голосования матч закончился - убираем все таймеры и сообщения
    this.server.on("NEW_GAME", async () => {
      for (let vote of this.votes.values()) {
        vote.clear();
      }
      this.timeStartLastGame = new Date().valueOf();
    });

    if (this.options.blockCreateSquadAfterDemote) {
      this.server.on("SQUAD_CREATED", async (data) => {
        if (data.player) {
          const vote = this.votes.get(data.player.teamID);
          if (vote && vote.playerHasBeenDemoted(data.player.steamID)) {
            await this.server.rcon.execute(
              `AdminRemovePlayerFromSquadById ${data.player.playerID}`
            );
            await this.server.rcon.warn(
              data.player.steamID,
              this
                .locale`You are not allowed to create a squad for this side in this match`
            );
          }
        }
      });
    }

    this.server.on(
      `CHAT_COMMAND:${this.options.startVoteCommand.toLowerCase()}`,
      this.onStartVoteCommand
    );
  }
}

/**
 * Голосование на кик сквадного из его же сквада через голосование запускаемое
 * командиром стороны
 */
class Vote {
  constructor(teamID, server, options) {
    this.isStarted = false;
    this.lastVoteTime = 0;
    this.votes = new Map();

    this.squadIDForDemotion = null;
    this.leaderForDemotion = null;
    this.teamID = teamID;
    this.server = server;
    this.options = options;

    this.messageProcessing = this.messageProcessing.bind(this);
    this.start = this.start.bind(this);
    this.warnSquadLeaders = this.warnSquadLeaders.bind(this);
    this.end = this.end.bind(this);
    this.playerHasBeenDemoted = this.playerHasBeenDemoted.bind(this);

    this.periodicallyMessageTimer;
    this.endVoteTimer;

    this.demotedPlayers = new Set();
  }
  /**
   * Проверка, что игрок был разжалован в этом матче
   * @param {*} player
   */
  playerHasBeenDemoted(steamID) {
    return this.demotedPlayers.has(steamID);
  }

  /**
   * Старт голосования, с валидацией сообщения, поиском сквада для которого
   * запросили голосование и поиском игрока, который в текущий момент сквадом управляет
   * @param {*} data
   * @returns
   */
  async start(data) {
    if (!(await this.startValidate(data))) {
      return;
    }

    this.squadIDForDemotion = data.message;

    this.leaderForDemotion = await this.server.getPlayerByCondition(
      (player) => {
        return (
          player.teamID === this.teamID &&
          player.squadID == this.squadIDForDemotion &&
          player.isLeader
        );
      },
      true
    );

    if (this.leaderForDemotion === null) {
      await this.server.rcon.warn(data.steamID, this.locale`Squad not found`);
      return;
    }

    this.isStarted = true;
    this.votes.clear();

    this.server.on("CHAT_MESSAGE", this.messageProcessing);
    this.endVoteTimer = setTimeout(
      this.end,
      this.options.endVoteTimeout * 1000
    );

    await this.warnSquadLeaders(
      this
        .locale`Demote squad leader ${this.squadIDForDemotion}, ${this.leaderForDemotion.name}? +/- to chat`
    );

    this.periodicallyMessageTimer = setInterval(
      this.warnSquadLeaders,
      this.options.periodicallyMessageTimeout * 1000,
      this
        .locale`Demote squad leader ${this.squadIDForDemotion}, ${this.leaderForDemotion.name}? +/- to chat`
    );
  }

  /**
   * Удаление всех таймаутов и остановка коллбеков
   */
  clearTimeoutsAndListeners() {
    clearInterval(this.periodicallyMessageTimer);
    clearTimeout(this.endVoteTimer);
    this.server.removeListener("CHAT_MESSAGE", this.messageProcessing);
  }

  /**
   * ПОЛНОЕ обнуление объекта и остановка голосования, если оно идёт,
   * например используется при старте новый игры
   */
  clear() {
    this.clearTimeoutsAndListeners();
    this.lastVoteTime = 0;
    this.isStarted = false;
    this.votes.clear();
    this.demotedPlayers = new Set();
    this.squadIDForDemotion = null;
    this.leaderForDemotion = null;
  }

  /**
   * Коллбек окончания голосования, подсчитывает голоса, выдаёт результат и применяет меры к сквадному
   * @returns
   */
  async end() {
    this.clearTimeoutsAndListeners();
    this.lastVoteTime = new Date().valueOf();
    this.isStarted = false;

    let [countPositively, countAgainst, countValidSquads, countVotedSquads] =
      await this.getResult();

    const countMinSquads = Math.floor(
      countValidSquads * this.options.minSquadsVotePercent
    );

    if (countVotedSquads <= countMinSquads) {
      await this.warnSquadLeaders(
        this
          .locale`Squad leader ${this.squadIDForDemotion} retained, less than ${this.options.minSquadsVotePercent * 100}% of squads voted (less than ${countMinSquads})`
      );
      return;
    }

    if (countPositively <= countAgainst) {
      await this.warnSquadLeaders(
        this
          .locale`Squad leader ${this.squadIDForDemotion} retained, ${countPositively} vs ${countAgainst}, had ${countValidSquads} eligible to vote`
      );
      return;
    }

    await this.warnSquadLeaders(
      this
        .locale`Squad leader ${this.squadIDForDemotion} was demoted, ${countPositively} vs ${countAgainst}, had ${countValidSquads} eligible to vote`
    );

    this.demotedPlayers.add(this.leaderForDemotion.steamID);

    // На всякий случай получаем пользователя, чтобы не кикнуть другого игрока,
    // т.к. удаление игрока из сквада идёт по переиспользуемому ID
    const player = await this.server.getPlayerBySteamID(
      this.leaderForDemotion.steamID,
      true
    );
    if (player) {
      await this.server.rcon.execute(
        `AdminRemovePlayerFromSquadById ${player.playerID}`
      );
    }
  }

  /**
   * Возвращает текущий ход голосования
   * @returns array [Количество "За", Количество "Против",
   * Количество сквадов которые имеют право голосовать,
   * Количество сквадов которые проголосовали (из тех, что имеют на это право)]
   */
  async getResult() {
    await this.server.updateSquadList();
    const validSquads = await this.server.squads.filter((data) => {
      return (
        data.teamID === this.teamID &&
        data.size >= this.options.minSquadSizeForVote &&
        data.squadID !== this.squadIDForDemotion
      );
    });

    let validSquadsIds = validSquads.map((squad) => squad.squadID);

    let countAgainst = 0;
    let countPositively = 0;
    let countAllValid = validSquadsIds.length;

    for (let [squadID, vote] of this.votes) {
      if (validSquadsIds.includes(squadID)) {
        vote ? countPositively++ : countAgainst++;
      }
    }

    const countAllVoted = countPositively + countAgainst;

    return [countPositively, countAgainst, countAllValid, countAllVoted];
  }

  /**
   * Валидирует команду на начало голосования, кидает варны, если необходимо
   * @param {object} data Данные, которые были переданы от ивента (steamID, playerID, message, etc...)
   * @returns true если валидация успешна, false если нет
   */
  async startValidate(data) {
    if (
      !(data.player.isLeader && data.player.squad.squadName === "Command Squad")
    ) {
      return false;
    }

    if (isNaN(Number(data.message))) {
      await this.server.rcon.warn(
        data.steamID,
        this
          .locale`Command should be in the format - !${this.options.startVoteCommand} <squad number>`
      );
    }

    if (this.isStarted) {
      await this.server.rcon.warn(
        data.steamID,
        this.locale`Voting is already in progress`
      );
      return false;
    }

    if (
      Date.now() <
      this.lastVoteTime.valueOf() + this.options.timeoutBetweenVote * 1000
    ) {
      await this.server.rcon.warn(
        data.steamID,
        this
          .locale`Voting is only available once every ${this.options.timeoutBetweenVote} seconds`
      );
      return false;
    }

    const squads = await this.server.squads.filter((squad) => {
      return squad.teamID === this.teamID;
    });

    if (squads.length < this.options.minSquadsForStart) {
      await this.server.rcon.warn(
        data.steamID,
        this
          .locale`Voting is available when there are at least ${this.options.minSquadsForStart} squads`
      );
      return false;
    }

    return true;
  }

  /**
   * Валидирует сообщение которое потенциально может быть голосом
   * @param {object} data Данные, которые были переданы от ивента (steamID, playerID, message, etc...)
   * @returns true если прошло валидацию, false если нет
   */
  async messageValidate(data) {
    if (
      data.player.teamID !== this.teamID ||
      data.player.isLeader === false ||
      data.player.squad === null
    ) {
      return false;
    }

    if (data.player.squadID === this.squadIDForDemotion) {
      await this.server.rcon.warn(
        data.steamID,
        this.locale`The vote of this squad is not counted`
      );
      return false;
    }

    if (data.player.squad.size < this.options.minSquadSizeForVote) {
      await this.server.rcon.warn(
        data.steamID,
        this
          .locale`The minimum squad size for voting is ${this.options.minSquadSizeForVote}`
      );
      return false;
    }

    return true;
  }

  /**
   * В зависимости от содержания сообщения выставляет голос в Map
   * @param {object} data Данные, которые были переданы от ивента (steamID, playerID, message, etc...)
   * @returns
   */
  async messageProcessing(data) {
    switch (data.message) {
      case "+":
        if (!(await this.messageValidate(data))) {
          return;
        }
        this.votes.set(data.player.squadID, true);
        await this.server.rcon.warn(
          data.steamID,
          this.locale`A positive vote is accepted`
        );
        break;
      case "-":
        if (!(await this.messageValidate(data))) {
          return;
        }
        this.votes.set(data.player.squadID, false);
        await this.server.rcon.warn(
          data.steamID,
          this.locale`A negative vote is accepted`
        );
        break;
    }
  }

  /**
   * Кидает варны всем сквад лидерам, также обновляет список игроков, \
   * чтобы не пропустить какого-либо сквад лидера
   * @param {string} message Текст сообщения
   */
  async warnSquadLeaders(message) {
    await this.server.updatePlayerList();

    const players = await this.server.players.filter((data) => {
      return data.teamID === this.teamID && data.isLeader;
    });

    for (let player of players) {
      await this.server.rcon.warn(player.steamID, message);
    }
  }
}
