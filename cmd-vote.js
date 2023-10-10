import BasePlugin from './base-plugin.js';


const [TEAM_ONE_ID, TEAM_TWO_ID] = ['1', '2']

export default class CMDVote extends BasePlugin {
  static get description() {
    return (
      'Голосование за разжалование командира сквада. Запускается командиром стороны'
    );
  }

  static get defaultEnabled() {
    return false;
  }

  static get optionsSpecification() {
    return {
      startVoteCommand: {
        required: false,
        description: 'Команда начала голосования за кик командира',
        default: 'cmdvote'
        },
      ignoreChats: {
        required: false,
        description: 'Пропускаемые чаты',
        default: ['ChatSquad', 'ChatAdmin']
      },
      endVoteTimeout: {
        required: false,
        description: 'Время на голосование в секундах',
        default: 60
      },
      timeoutAfterNewMap: {
        required: false,
        description: 'Время после начала новой карты в которое недоступна команда',
        default: 300
      },
      minSquadSizeForVote: {
        required: false,
        description: 'Минимальный размер сквада для зачета голоса',
        default: 4
      },
      minSquadsForStart: {
        required: false,
        description: 'Минимальное количество сквадов за сторону после которого активна команда',
        default: 4
      },
      minSquadsVotePercent: {
        required: false,
        description: 'Минимальный процент проголосовавших для зачета результата, дробное значение',
        default: 0.40
      },
      periodicallyMessageTimeout: {
        required: false,
        description: 'Время между сообщениями о ходе голосования, в секундах',
        default: 8
      },
      timeoutBetweenVote: {
        required: false,
        description: 'Таймаут между голосованиями в секундах',
        default: 100
      },
      blockCreateSquadAfterDemote: {
        required: false,
        description: 'Блокировать ли разжалованному игроку создание сквада до конца текущей карты',
        default: true
      }
    };
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);

    this.votes = new Map([
        [TEAM_ONE_ID, new Vote(TEAM_ONE_ID, this.server, this.options)],
        [TEAM_TWO_ID, new Vote(TEAM_TWO_ID, this.server, this.options)]
      ]
    );

    this.timeStartLastGame = 0;

    this.onStartVoteCommand = this.onStartVoteCommand.bind(this);
  }

  async onStartVoteCommand(data) {
    if (Date.now() < this.timeStartLastGame + this.options.timeoutAfterNewMap * 1000) {
      this.server.rcon.warn(data.steamID, `Голосование доступно через ${this.options.timeoutAfterNewMap} секунд после начала игры`);
      return;
    }

    if (data.message) {
      const vote = this.votes.get(data.player.teamID)
      await vote.start(data)
    }
  }

  async mount() {
    // Если во время голосования матч закончился - убираем все таймеры и сообщения
    this.server.on('NEW_GAME', async () => {
      for (let vote of this.votes.values()) {
        vote.clear()
      }
      this.timeStartLastGame = new Date().valueOf();
    });

    if (this.options.blockCreateSquadAfterDemote) {
      this.server.on('SQUAD_CREATED', async (data) => {
        if (data.player) {
          const vote = this.votes.get(data.player.teamID);
          if (vote.playerHasBeenDemoted(data.player.steamID)) {
            await this.server.rcon.execute(`AdminRemovePlayerFromSquadById ${data.player.playerID}`);
            await this.server.rcon.warn(data.player.steamID, 'В этом матче вам запрещено создавать сквад за данную сторону');
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

    this.demotedPlayers = [];
  }
  /**
   * Проверка, что игрок был разжалован в этом матче
   * @param {*} player
   */
  playerHasBeenDemoted(steamID) {
    return this.demotedPlayers.includes(steamID);
  }

  /**
   * Старт голосования, с валидацией сообщения, поиском сквада для которого
   * запросили голосование и поиском игрока, который в текущий момент сквадом управляет
   * @param {*} data
   * @returns
   */
  async start(data) {
    if (!await this.startValidate(data)) {
      // this.verbose('Запуск голосования не прошел валидацию');
      return;
    }

    this.squadIDForDemotion = data.message;

    this.leaderForDemotion = await this.server.getPlayerByCondition(
      (player) => {
        return player.teamID === this.teamID && player.squadID === this.squadIDForDemotion && player.isLeader;
      },
      true
    );

    // this.verbose(this.leaderForDemotion)

    if (this.leaderForDemotion === null) {
      this.server.rcon.warn(data.steamID, 'Сквад не найден');
      // this.verbose(`Сквад ${this.squadIDForDemotion} не найден`);
      return;
    }


    this.isStarted = true;
    this.votes.clear();

    this.server.on('CHAT_MESSAGE', this.messageProcessing);
    this.endVoteTimer = setTimeout(this.end, this.options.endVoteTimeout * 1000);

    await this.warnSquadLeaders(`Снимаем командира ${this.squadIDForDemotion} отряда, ${this.leaderForDemotion.name}? +/- в чат`)

    this.periodicallyMessageTimer = setInterval(
      this.warnSquadLeaders,
      this.options.periodicallyMessageTimeout * 1000,
      `Снимаем командира ${this.squadIDForDemotion} отряда, ${this.leaderForDemotion.name}? +/- в чат`
    );

    // this.verbose(`Голосование за снятие командира запущено`);
  }

  /**
   * Удаление всех таймаутов и остановка коллбеков
   */
  clearTimeoutsAndListeners() {
    clearInterval(this.periodicallyMessageTimer)
    clearTimeout(this.endVoteTimer)
    this.server.removeListener('CHAT_MESSAGE', this.messageProcessing)
  }

  /**
   * ПОЛНОЕ обнуление объекта и остановка голосования, если оно идёт,
   * например используется при старте новый игры
   */
  clear() {
    this.clearTimeoutsAndListeners()
    this.lastVoteTime = 0
    this.isStarted = false;
    this.votes.clear();
    this.demotedPlayers = [];
    this.squadIDForDemotion = null;
    this.leaderForDemotion = null;
  }

  /**
   * Коллбек окончания голосования, подсчитывает голоса, выдаёт результат и применяет меры к сквадному
   * @returns
   */
  async end() {
    this.clearTimeoutsAndListeners()
    this.lastVoteTime = new Date().valueOf();
    this.isStarted = false;

    let [countPositively, countAgainst, countValidSquads, countVotedSquads] = await this.getResult();

    const countMinSquads = Math.floor(
      countValidSquads * this.options.minSquadsVotePercent
    );

    // this.verbose(`Окончание голосования, за ${countPositively}, против ${countAgainst}. валидных ${countAllValid}, проголосовавших ${countAllVoted}`)

    if (countVotedSquads <= countMinSquads) {
      await this.warnSquadLeaders(`Командир ${this.squadIDForDemotion} отряда оставлен в должности, проголосовало меньше ${this.options.minSquadsVotePercent * 100}% отрядов (меньше ${countMinSquads})`);
      return;
    }

    if (countPositively <= countAgainst) {
      await this.warnSquadLeaders(`Командир ${this.squadIDForDemotion} отряда оставлен в должности, за ${countPositively}, против ${countAgainst}, имели право голоса ${countValidSquads}`);
      return;
    }

    await this.warnSquadLeaders(`Командир ${this.squadIDForDemotion} отряда снят с должности, за ${countPositively}, против ${countAgainst}, имели право голоса ${countValidSquads}`);

    this.demotedPlayers.push(this.leaderForDemotion.steamID)

    // На всякий случай получаем пользователя, чтобы не кикнуть другого игрока,
    // т.к. удаление игрока из сквада идёт по переиспользуемому ID
    const player = await this.server.getPlayerBySteamID(this.leaderForDemotion.steamID, true);
    if (player) {
      await this.server.rcon.execute(`AdminRemovePlayerFromSquadById ${player.playerID}`);
    }
  }

  /**
   * Возвращает текущий ход голосования
   * @returns array [Количество "За", Количество "Против",
   * Количество сквадов которые имеют право голосовать,
   * Количество сквадов которые проголосовали (из тех, что имеют на это право)]
   */
  async getResult() {
    await this.server.updateSquadList()
    const validSquads = await this.server.squads.filter(
      (data) => {
        return data.teamID === this.teamID && data.size >= this.options.minSquadSizeForVote && data.squadID !== this.squadIDForDemotion;
      }
    );

    let validSquadsIds = validSquads.map(squad => squad.squadID)

    let countAgainst = 0;
    let countPositively = 0;
    let countAllValid = validSquadsIds.length;

    for (let [squadID, vote] of this.votes) {
      if (validSquadsIds.includes(squadID)) {
        vote ? countPositively++ : countAgainst++;
      }
    }

    const countAllVoted = countPositively + countAgainst

    return [countPositively, countAgainst, countAllValid, countAllVoted]
  }

  /**
   * Валидирует команду на начало голосования, кидает варны, если необходимо
   * @param {object} data Данные, которые были переданы от ивента (steamID, playerID, message, etc...)
   * @returns true если валидация успешна, false если нет
   */
  async startValidate(data) {
    if (!(data.player.isLeader && data.player.squad.squadName === 'Command Squad')) {
      // this.verbose('Не сквадлид или неправильное название сквада')
      return false;
    }

    if (isNaN(Number(data.message))) {
      await this.server.rcon.warn(
        data.steamID,
        `Команда должна быть в формате - !${this.options.startVoteCommand} <номер сквада>`
      )
    }

    if (this.isStarted) {
      await this.server.rcon.warn(data.steamID, 'Голосование уже идёт');
      return false;
    }

    if (Date.now() < this.lastVoteTime.valueOf() + this.options.timeoutBetweenVote * 1000) {
      await this.server.rcon.warn(
        data.steamID,
        `Голосование доступно только раз в ${this.options.timeoutBetweenVote} секунд`
      );
      return false;
    }

    const squads = await this.server.squads.filter(
      (squad) => {
        return squad.teamID === this.teamID;
      }
    );

    if (squads.length < this.options.minSquadsForStart) {
      await this.server.rcon.warn(
        data.steamID,
        `Голосование доступно при наличии минимум ${this.options.minSquadsForStart} сквадов`
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
    if (data.player.isLeader === false || data.player.squad === null) {
      return false;
    }

    if (data.player.squadID === this.squadIDForDemotion) {
      await this.server.rcon.warn(
        data.steamID,
        'Голос данного сквада не учитывается'
      );
      return false;
    }

    if (data.player.squad.size < this.options.minSquadSizeForVote) {
      await this.server.rcon.warn(
        data.steamID,
        `Минимальный размер сквада для голосования - ${this.options.minSquadSizeForVote}`
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
      case '+':
        if (!await this.messageValidate(data)) {
          // this.verbose(`Сообщение голосования не прошло валидацию ${data.steamID}, ${data.message}`);
          return;
        }
        this.votes.set(data.player.squadID, true);
        await this.server.rcon.warn(data.steamID, 'Голос "за" принят')
        break;
      case '-':
        if (!await this.messageValidate(data)) {
          // this.verbose(`Сообщение голосования не прошло валидацию ${data.steamID}, ${data.message}`);
          return;
        }
        this.votes.set(data.player.squadID, false);
        await this.server.rcon.warn(data.steamID, 'Голос "против" принят')
        break;
    }

    // this.verbose(`Голос принят ${data.steamID}`);
  }

  /**
   * Кидает варны всем сквад лидерам, также обновляет список игроков, \
   * чтобы не пропустить какого-либо сквад лидера
   * @param {string} message Текст сообщения
   */
  async warnSquadLeaders(message) {
    await this.server.updatePlayerList()

    const players = await this.server.players.filter(
      (data) => {
        return data.teamID === this.teamID && data.isLeader;
      }
    );

    for (let player of players) {
      await this.server.rcon.warn(player.steamID, message);
    }
  }

  /**
   * Логирование
   * @param {*} message
   */
  verbose(message) {
    console.log(message)
  }
}
