import BasePlugin from './base-plugin.js';

export default class CMDVote extends BasePlugin {
  static get description() {
    return (
      'Голосование за расжалование командира сквада. Запускается командиром стороны'
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
        default: 2
      },
      minSquadsForStart: {
        required: false,
        description: 'Минимальное количество сквадов за сторону после которого активна команда',
        default: 4
      },
      minSquadsVotePercent: {
        required: false,
        description: 'Минимальный процент проголосовавших для зачета результата, дробное значение',
        default: 0.50
      },
      periodicallyMessageTimeout: {
        required: false,
        description: 'Время между сообщениями о ходе голосования, в секундах',
        default: 10
      },
      timeoutBetweenVote: {
        required: false,
        description: 'Таймаут между голосованиями в секундах',
        default: 120
      }
    };
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);

    this.votes = new Map([
        ['1', new Vote('1', this.server, this.options)],
        ['2', new Vote('2', this.server, this.options)]
      ]
    );
    this.timeStartLastGame = 0;
    this.onStartVoteCommand = this.onStartVoteCommand.bind(this)
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
    })

    this.server.on(
      `CHAT_COMMAND:${this.options.startVoteCommand.toLowerCase()}`,
      this.onStartVoteCommand
    );
  }
}

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

    this.periodicallyMessageTimer;
    this.endVoteTimer;
  }

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

    this.periodicallyMessageTimer = setInterval(
      this.warnSquadLeaders,
      this.options.periodicallyMessageTimeout * 1000,
      `Голосование за снятие командира ${this.squadIDForDemotion} отряда, ${this.leaderForDemotion.name}, +/- в чат`
    );

    // this.verbose(`Голосование за снятие командира запущено`);
  }

  clearTimeoutsAndListeners() {
    clearInterval(this.periodicallyMessageTimer)
    clearTimeout(this.endVoteTimer)
    this.server.removeListener('CHAT_MESSAGE', this.messageProcessing)
  }

  clear() {
    this.clearTimeoutsAndListeners()
    this.lastVoteTime = 0
    this.isStarted = false;
    this.votes.clear()
    this.squadIDForDemotion = null;
    this.leaderForDemotion = null;
  }

  async end() {
    this.clearTimeoutsAndListeners()
    this.lastVoteTime = new Date().valueOf();
    this.isStarted = false;

    let [countPositively, countAgainst, countAllValidVoted] = await this.getResult();

    const countMinSquads = Math.floor(
      countAllValidVoted * this.options.minSquadsVotePercent
    );

    // this.verbose(`Окончание голосования, за ${countPositively}, против ${countAgainst}`)
    if (countAllValidVoted >= countMinSquads) {
      await this.warnSquadLeaders(`Командир ${this.squadIDForDemotion} отряда оставлен в должности, проголосовало меньше ${this.options.minSquadsVotePercent * 100}% отрядов (меньше ${countAllValidVoted})`);
      return;
    }

    if (countPositively <= countAgainst) {
      await this.warnSquadLeaders(`Командир ${this.squadIDForDemotion} отряда оставлен в должности, за ${countPositively}, против ${countAgainst}, имели право голоса ${countAllValidVoted}`);
      return;
    }

    await this.warnSquadLeaders(`Командир ${this.squadIDForDemotion} отряда снят с должности, за ${countPositively}, против ${countAgainst}, имели право голоса ${countAllValidVoted}`);

    // На всякий случай получаем пользователя, чтобы не кикнуть другого игрока,
    // т.к. удаление игрока из сквада идёт по переиспользуемому ID
    const player = await this.server.getPlayerBySteamID(this.leaderForDemotion.steamID, true);
    if (player) {
      await this.server.rcon.execute(`AdminRemovePlayerFromSquadById ${player.playerID}`);
    }
  }

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
    let countAllValidVoted = validSquadsIds.length;

    for (let [squadID, vote] of this.votes) {
      if (validSquadsIds.includes(squadID)) {
        vote ? countPositively++ : countAgainst++;
      }
    }

    return [countPositively, countAgainst, countAllValidVoted]
  }

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

  async messageProcessing(data) {
    if (!await this.messageValidate(data)) {
      // this.verbose(`Сообщение голосования не прошло валидацию ${data}`);
      return;
    }

    switch (data.message) {
      case '+':
        this.votes.set(data.player.squadID, true);
        await this.server.rcon.warn(data.steamID, 'Голос "за" принят')
        break;
      case '-':
        this.votes.set(data.player.squadID, false);
        await this.server.rcon.warn(data.steamID, 'Голос "против" принят')
        break;
    }

    // this.verbose(`Голос принят ${data.steamID}`);
  }

  async warnSquadLeaders(message) {
    const players = await this.server.players.filter(
      (data) => {
        return data.teamID === this.teamID && data.isLeader;
      }
    );

    for (let player of players) {
      await this.server.rcon.warn(player.steamID, message);
    }
  }

  verbose(data) {
    console.log(data)
  }
}
