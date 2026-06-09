import express from 'express'
import adminNotificationRoutes from './routes/adminNotificationRoutes.js'

const app = express()
app.use('/api', adminNotificationRoutes)

const server = app.listen(0, async () => {
    const { port } = server.address()
    const base = `http://127.0.0.1:${port}`

    const urls = [
        `${base}/api/notifications/pending-counts`,
        `${base}/api/admin/notifications`,
        `${base}/api/admin/notifications?role=admin`
    ]

    for (const url of urls) {
        const res = await fetch(url)
        const body = await res.text()
        console.log('URL:', url)
        console.log('STATUS:', res.status)
        console.log(body)
        console.log('---')
    }

    server.close()
})
