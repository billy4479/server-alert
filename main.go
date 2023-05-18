package main

import (
	"database/sql"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"

	"github.com/Jeffail/gabs/v2"
	_ "github.com/go-sql-driver/mysql"
	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
	"github.com/joho/godotenv"
	"github.com/labstack/echo/v4"
)

type notification struct {
	serverName string
	username   string
	isOpen     bool
}

func webServer(db *sql.DB, notify chan notification) error {
	e := echo.New()
	e.Debug = true
	e.HideBanner = true

	e.POST("/hook", func(c echo.Context) error {
		defer c.Request().Body.Close()
		b, err := io.ReadAll(c.Request().Body)
		if err != nil {
			return err
		}

		j, err := gabs.ParseJSON(b)
		if err != nil {
			return err
		}

		commits := j.Search("commits").Children()
		last := commits[len(commits)-1]
		message := last.S("message").Data().(string)
		repoName := j.Search("repository", "full_name").Data().(string)
		username := j.Search("pusher", "name").Data().(string)

		// TODO: refine here
		isOpen := message == "Acquiring lock"

		if isOpen {
			_, err := db.Exec("UPDATE ServerStatus SET IsOpen = 1, LockHolder = ? WHERE Name = ?", username, repoName)
			if err != nil {
				return err
			}
		} else {
			_, err := db.Exec("UPDATE ServerStatus SET IsOpen = 0, LockHolder = NULL WHERE Name = ?", repoName)
			if err != nil {
				return err
			}
		}
		notify <- notification{
			serverName: repoName,
			username:   username,
			isOpen:     isOpen,
		}

		return c.NoContent(http.StatusOK)
	})

	e.GET("/ping", func(c echo.Context) error {
		return c.String(http.StatusOK, "pong")
	})

	return e.Start(":" + os.Getenv("PORT"))
}

func bot(db *sql.DB, notifications chan notification, errors chan error) error {
	bot, err := tgbotapi.NewBotAPI(os.Getenv("TG_TOKEN"))
	if err != nil {
		return err
	}

	u := tgbotapi.NewUpdate(0)
	u.Timeout = 60

	updates := bot.GetUpdatesChan(u)

	go func() {
		for notification := range notifications {
			rows, err := db.Query("SELECT ChannelID FROM ServerStatus WHERE Name = ?", notification.serverName)
			if err != nil {
				errors <- err
				return
			}

			rows.Next()
			var channelID sql.NullInt64
			err = rows.Scan(&channelID)
			if err != nil {
				errors <- err
				return
			}

			if !channelID.Valid {
				continue
			}

			msg := ""
			if notification.isOpen {
				msg = fmt.Sprintf("`%s` was *started* by _%s_", notification.serverName, notification.username)
			} else {
				msg = fmt.Sprintf("`%s` was *closed*", notification.serverName)
			}

			message := tgbotapi.NewMessage(channelID.Int64, msg)
			message.ParseMode = "MarkdownV2"
			_, err = bot.Send(message)
			if err != nil {
				errors <- err
				return
			}
		}
	}()

	for update := range updates {
		if update.Message != nil {
			log.Printf("[%s] %s", update.Message.From.UserName, update.Message.Text)

			command := update.Message.Command()

			switch command {
			case "status":
				{
					serverName := update.Message.CommandArguments()
					result, err := db.Query("SELECT IsOpen, LockHolder FROM ServerStatus WHERE Name = ?", serverName)
					if err != nil {
						return err
					}

					var isOpen bool
					var lockHolder sql.NullString
					if !result.Next() {
						continue
					}
					err = result.Scan(&isOpen, &lockHolder)
					if err != nil {
						return err
					}

					msg := ""
					if isOpen {
						msg = fmt.Sprintf("`%s` is currently *open* by _%s_", serverName, lockHolder.String)
					} else {
						msg = fmt.Sprintf("`%s` is currently *closed*", serverName)
					}

					message := tgbotapi.NewMessage(update.Message.Chat.ID, msg)
					message.ParseMode = "MarkdownV2"
					_, err = bot.Send(message)
					if err != nil {
						return err
					}
				}
			case "subscribe":
				{
					serverName := update.Message.CommandArguments()
					_, err := db.Exec("UPDATE ServerStatus SET ChannelID = ? WHERE Name = ?", update.Message.Chat.ID, serverName)
					if err != nil {
						return err
					}

					_, err = bot.Send(tgbotapi.NewMessage(update.Message.Chat.ID, fmt.Sprintf("Subscribed to %s", serverName)))
					if err != nil {
						return err
					}
				}
			}
		}
	}

	return nil
}

func run() error {
	// Ignore errors, we just go with the current environment
	_ = godotenv.Load()

	db, err := sql.Open("mysql", os.Getenv("DSN"))

	if err != nil {
		return err
	}

	defer db.Close()

	if err := db.Ping(); err != nil {
		return err
	}

	errorsChan := make(chan error)
	notificationsChan := make(chan notification)

	go func() {
		errorsChan <- bot(db, notificationsChan, errorsChan)
	}()

	go func() {
		errorsChan <- webServer(db, notificationsChan)
	}()

	for err := range errorsChan {
		if err != nil {
			return err
		}
	}

	return nil
}

func main() {
	if err := run(); err != nil {
		log.Fatalln(err)
	}
}
