# ⭐ If it's useful, give it a star ⭐

# English

Vote triggered by side commander (CMD) to demote a squad leader

A demoted squad leader cannot create a squad for the current side for the rest of the game

Tested on SquadJS 4.1.0 https://github.com/Team-Silver-Sphere/SquadJS/releases/tag/v4.1.0

# Important!

The plugin realizes that the requesting !cmdvote is the commander of the side by two things - isLeader, which is obtained from Rcon and the name of the squad Command Squad. If there is no problem with isLeader, then the name can be faked through the command in the console `CreateSquad 'Command Squad' false`, it is important to monitor and block the creation of squads with such a name so that ordinary players can not abuse the voting system.

# Settings

- Download the repository
```bash
git clone https://github.com/ar1ocker/SquadJS-Commander-Vote/
```

- Copy the `cmd-vote.js` file and the `cmd-vote-locales` folder to the ``<path to squadjs on server>/squad-server/plugins/` folder.

- Add the new plugin to config.json (plugins section)
```
{
"plugin": "CMDVote",
"enabled": true,
"language": "en"
},
```

For other settings, see the `cmd-vote.js` file.

# Russian

# SquadJS-Commander-Vote

Голосование запускаемое командиром стороны (CMD) для разжалования командира отряда

Расжалованный командир отряда не может создавать отряд за текущую сторону до конца игры

Проверено на версии SquadJS 4.1.0 https://github.com/Team-Silver-Sphere/SquadJS/releases/tag/v4.1.0

# Важно!

Плагин понимает, что запрашивающий !cmdvote является командиром стороны по двум вещам - isLeader которые получается из Rcon и названию сквада Command Squad. Если с isLeader проблем нет, то вот название можно подделать через команду в консоли `CreateSquad 'Command Squad' false`, важно отслеживать и блокировать создание сквадов с таким названием дабы обычные игроки не могли абьюзить систему голосования

# Настройка

- Скачайте репозиторий
```bash
git clone https://github.com/ar1ocker/SquadJS-Commander-Vote/
```

- Скопируйте файл `cmd-vote.js` и папку `cmd-vote-locales` в папку `<путь до squadjs на сервере>/squad-server/plugins/`

- Добавьте новый плагин в config.json (раздел plugins)
```
{
    "plugin": "CMDVote",
    "enabled": true,
    "language": "ru"
},
```

Остальные настройки смотрите в файле `cmd-vote.js`

- Если необходимо, настройте параметры голосования в файле `cmd-vote.js` или `config.json` (также как и для остальных плагинов)
