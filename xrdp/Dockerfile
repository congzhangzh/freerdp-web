# Throwaway RDP server for testing the browser client (never touches the live GRD).
FROM debian:testing
RUN apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
      xrdp xorgxrdp openbox xterm dbus-x11 x11-xserver-utils fonts-dejavu-core ssl-cert >/dev/null \
 && useradd -m -s /bin/bash test && echo 'test:test' | chpasswd \
 && echo 'exec openbox-session' > /home/test/.xsession && chown test:test /home/test/.xsession \
 && mkdir -p /home/test/.config/openbox && echo 'xsetroot -solid "#2e6b8a" & xterm -geometry 100x30+40+40 &' > /home/test/.config/openbox/autostart \
 && chown -R test:test /home/test/.config && adduser xrdp ssl-cert
EXPOSE 3389
CMD ["/bin/sh", "-c", "rm -f /var/run/xrdp/*.pid; xrdp-sesman && exec xrdp --nodaemon"]
