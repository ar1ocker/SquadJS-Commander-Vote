# ⭐ Пригодилось - поставь звездочку ⭐
# SquadJS-Commander-Vote

Голосование запускаемое командиром стороны (CMD) для разжалования командира отряда

Проверено на версии SquadJS 4.0.0 с патчами от https://github.com/fantinodavide/SquadJS/tree/eos-integration

# Важно!

Плагин понимает, что запрашивающий !cmdvote является командиром стороны по двум вещам - isLeader которые получается из Rcon и названию сквада Command Squad. Если с isLeader проблем нет, то вот название можно подделать через команду в консоли `CreateSquad 'Command Squad' false`, важно отслеживать и блокировать создание сквадов с таким названием дабы обычные игроки не могли абьюзить систему голосования

# Настройка

- Скачайте репозиторий
```bash
git clone https://github.com/ar1ocker/SquadJS-Commander-Vote/
```

- Скопируйте файл `cmd-vote.js` в папку `<путь до squadjs на сервере>/squad-server/plugins/`

- Добавьте новый плагин в config.json (раздел plugins)
```
{
    "plugin": "CMDVote",
    "enabled": true
},
```

- Если необходимо, настройте параметры голосования в файле `cmd-vote.js` или `config.json` (также как и для остальных плагинов)
