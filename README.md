# SquadJS-Commander-Vote

Голосование запускаемое командиром стороны (CMD) для разжалования командира отряда

Проверено на версии SquadJS 4.0.0 с патчами от https://github.com/fantinodavide/SquadJS/tree/eos-integration

# Настройка

- Скачайте репозиторий
```bash
git clone https://github.com/ar1ocker/SquadJS-Commander-Vote/
```

- Скопируйте файл `cmd-vote.js` в папку `<путь до squadjs на сервере>/squad-server/plugins/`
- Примените патч находясь в папке `<путь до squadjs на сервере>/`
```bash
git apply <путь до файла patch> --verbose
```

- Добавьте новый плагин в config.json (раздел plugins)
```
{
    "plugin": "CMDVote",
    "enabled": true
},
```

- Если необходимо, настройте параметры голосования в файле `cmd-vote.js`

# ⭐ Пригодилось? Звездочку поставь. ⭐
